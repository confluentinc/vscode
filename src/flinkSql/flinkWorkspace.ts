import type { Uri } from "vscode";
import * as vscode from "vscode";
import { getCCloudAuthSession } from "../authn/utils";
import type { GetWsV1Workspace200Response } from "../clients/flinkWorkspaces";
import { flinkWorkspaceUri } from "../emitters";
import { CCloudResourceLoader } from "../loaders/ccloudResourceLoader";
import { Logger } from "../logging";
import type { IFlinkQueryable } from "../models/resource";
import { getSidecar } from "../sidecar";
import { FLINK_SQL_LANGUAGE_ID } from "./constants";

const logger = new Logger("flinkSql.flinkWorkspace");

/**
 * Interface for Flink workspace parameters extracted from a URI.
 * Note: provider and region are not required - they are looked up from the environment's
 * Flink compute pools.
 */
export interface FlinkWorkspaceParams {
  environmentId: string;
  organizationId: string;
  workspaceName: string;
}

/**
 * Extract Flink workspace parameters from a URI's query string.
 * @param uri The URI containing workspace parameters in its query string
 * @returns Parsed workspace parameters, or null if required parameters are missing
 */
export function extractWorkspaceParamsFromUri(uri: Uri): FlinkWorkspaceParams | null {
  const params = new URLSearchParams(uri.query);

  const environmentId = params.get("environmentId");
  const organizationId = params.get("organizationId");
  const workspaceName = params.get("workspaceName");

  if (!environmentId || !organizationId || !workspaceName) {
    logger.warn("Missing required workspace parameters in URI", {
      environmentId,
      organizationId,
      workspaceName,
    });
    return null;
  }

  return {
    environmentId,
    organizationId,
    workspaceName,
  };
}

/**
 * Fetch and validate a Flink workspace from the API.
 * Since the Flink Workspaces API is region-scoped, this function discovers the available
 * regions from the environment's Flink compute pools and searches each region for the workspace.
 *
 * @param params Workspace parameters to validate against
 * @returns The workspace response if validation succeeds, null otherwise
 */
export async function getFlinkWorkspace(
  params: FlinkWorkspaceParams,
): Promise<GetWsV1Workspace200Response | null> {
  // 1. Ensure we have a signed-in CCloud session (prompts login if needed)
  try {
    await getCCloudAuthSession({ createIfNone: true });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "User did not consent to login." || error.name === "CCloudConnectionError")
    ) {
      return null; // User cancelled - silent exit
    }
    throw error;
  }

  // 2. Load the environment to discover available provider/region combinations
  const loader = CCloudResourceLoader.getInstance();
  const environments = await loader.getEnvironments();
  const environment = environments.find((env) => env.id === params.environmentId);

  if (!environment) {
    logger.warn("Environment not found", { environmentId: params.environmentId });
    return null;
  }

  // Use the existing determineFlinkQueryables method to get unique provider/region combinations
  const flinkQueryables = await loader.determineFlinkQueryables(environment);
  if (flinkQueryables.length === 0) {
    logger.warn("No Flink compute pools found in environment", {
      environmentId: params.environmentId,
    });
    return null;
  }

  logger.debug(`Found ${flinkQueryables.length} unique region(s) to search`, {
    regions: flinkQueryables.map((q) => `${q.provider}/${q.region}`),
  });

  // 3. Search for the workspace across regions
  const workspace = await findWorkspaceInRegions(params, flinkQueryables);

  if (!workspace) {
    return null;
  }

  // 4. Validate workspace matches expected organization and environment
  if (workspace.organization_id !== params.organizationId) {
    logger.warn("Organization ID mismatch", {
      expected: params.organizationId,
      actual: workspace.organization_id,
    });
    return null;
  }

  if (workspace.environment_id !== params.environmentId) {
    logger.warn("Environment ID mismatch", {
      expected: params.environmentId,
      actual: workspace.environment_id,
    });
    return null;
  }

  return workspace;
}

/**
 * Search for a workspace across multiple provider/region combinations.
 *
 * @param params Workspace parameters (workspaceName is used for the query)
 * @param flinkQueryables The provider/region combinations to search (from determineFlinkQueryables)
 * @returns The workspace if found, null otherwise
 */
async function findWorkspaceInRegions(
  params: FlinkWorkspaceParams,
  flinkQueryables: IFlinkQueryable[],
): Promise<GetWsV1Workspace200Response | null> {
  const sidecar = await getSidecar();

  // Search each region sequentially until we find the workspace.
  // Sequential search is preferred here because:
  // 1. Most environments have 1-2 regions, so parallelization overhead isn't worth it
  // 2. We stop as soon as we find the workspace (fail-fast)
  // 3. Easier error handling and logging
  for (const queryable of flinkQueryables) {
    try {
      const workspacesApi = sidecar.getFlinkWorkspacesWsV1Api(queryable);
      const workspace = await workspacesApi.getWsV1Workspace({
        organization_id: queryable.organizationId,
        environment_id: queryable.environmentId,
        name: params.workspaceName,
      });

      logger.debug(`Found workspace in region ${queryable.provider}/${queryable.region}`, {
        workspaceName: params.workspaceName,
      });

      return workspace;
    } catch {
      // 404 means workspace doesn't exist in this region - continue searching
      // Other errors are logged but we continue to try other regions
      logger.debug(`Workspace not found in region ${queryable.provider}/${queryable.region}`, {
        workspaceName: params.workspaceName,
      });
    }
  }

  // Workspace not found in any region
  logger.warn("Workspace not found in any region", {
    workspaceName: params.workspaceName,
    environmentId: params.environmentId,
    searchedRegions: flinkQueryables.map((q) => `${q.provider}/${q.region}`),
  });

  return null;
}

/**
 * Extract SQL statements from workspace blocks.
 * Each block contains code_options.source array of SQL lines.
 *
 * @param workspace The workspace containing SQL blocks
 * @returns Array of SQL statement strings
 */
export function extractSqlStatementsFromWorkspace(
  workspace: GetWsV1Workspace200Response,
): string[] {
  const sqlStatements: string[] = [];

  if (!workspace.spec.blocks || !Array.isArray(workspace.spec.blocks)) {
    logger.debug("No blocks found in workspace spec");
    return sqlStatements;
  }

  for (const block of workspace.spec.blocks) {
    if (!block.code_options?.source || block.code_options.source.length === 0) {
      logger.debug("Block has no code_options.source, skipping", { blockType: block.type });
      continue;
    }

    // Join the source lines to form a complete SQL statement
    const sqlStatement = block.code_options.source.join("\n");
    if (sqlStatement.trim()) {
      sqlStatements.push(sqlStatement);
    }
  }

  logger.debug(`Extracted ${sqlStatements.length} SQL statements from workspace`);
  return sqlStatements;
}

/**
 * Handle a flinkWorkspace URI event by creating and opening a .flink.sql file.
 * Validates the workspace exists before creating the file.
 *
 * @param uri The URI containing workspace parameters
 */
export async function handleFlinkWorkspaceUriEvent(uri: Uri): Promise<void> {
  logger.debug("Handling Flink workspace URI event", { uri: uri.toString() });

  // Extract workspace parameters from the URI
  const params = extractWorkspaceParamsFromUri(uri);
  if (!params) {
    vscode.window.showErrorMessage("Invalid Flink workspace URI: missing required parameters");
    return;
  }

  // Validate the workspace exists
  const workspace = await getFlinkWorkspace(params);
  if (!workspace) {
    vscode.window.showErrorMessage(
      `Unable to load Flink workspace: ${params.workspaceName}. Please verify the workspace exists and you have access.`,
    );
    return;
  }

  // Extract SQL statements from the workspace
  const sqlStatements = extractSqlStatementsFromWorkspace(workspace);

  // If no statements found, show a single empty document
  if (sqlStatements.length === 0) {
    try {
      const document = await vscode.workspace.openTextDocument({
        language: FLINK_SQL_LANGUAGE_ID,
        content: `-- No SQL statements found in workspace --`,
      });
      await vscode.window.showTextDocument(document);
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to open Flink SQL workspace: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return;
  }

  // Create and open a separate document for each SQL statement
  try {
    for (const statement of sqlStatements) {
      const content = `${statement}`;
      const document = await vscode.workspace.openTextDocument({
        language: FLINK_SQL_LANGUAGE_ID,
        content: content,
      });
      await vscode.window.showTextDocument(document, { preview: false });
    }
  } catch (error) {
    vscode.window.showErrorMessage(
      `Failed to open Flink SQL workspace: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Register a handler for the flinkWorkspaceUri event emitter.
 * @returns A Disposable that unregisters the handler when disposed
 */
export function setFlinkWorkspaceListener(): vscode.Disposable {
  return flinkWorkspaceUri.event(handleFlinkWorkspaceUriEvent);
}
