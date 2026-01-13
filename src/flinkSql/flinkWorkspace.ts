import type { Uri } from "vscode";
import * as vscode from "vscode";
import { getCCloudAuthSession } from "../authn/utils";
import type { GetWsV1Workspace200Response } from "../clients/flinkWorkspaces";
import { flinkWorkspaceUri } from "../emitters";
import { logError } from "../errors";
import { Logger } from "../logging";
import type { EnvironmentId, IEnvProviderRegion } from "../models/resource";
import { getSidecar } from "../sidecar";
import { hasCCloudAuthSession } from "../sidecar/connections/ccloud";
import { FLINK_SQL_LANGUAGE_ID } from "./constants";

const logger = new Logger("flinkSql.flinkWorkspace");

/**
 * Interface for Flink workspace parameters extracted from a URI.
 */
export interface FlinkWorkspaceParams {
  environmentId: string;
  region: string;
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
  const region = params.get("region");
  const organizationId = params.get("organizationId");
  const workspaceName = params.get("workspaceName");

  if (!environmentId || !region || !organizationId || !workspaceName) {
    logger.warn("Missing required workspace parameters in URI", {
      environmentId,
      region,
      organizationId,
      workspaceName,
    });
    return null;
  }

  return {
    environmentId,
    region,
    organizationId,
    workspaceName,
  };
}

/**
 * Fetch and validate a Flink workspace from the API.
 * Ensures the workspace exists and matches the expected organization, environment, and region.
 *
 * @param params Workspace parameters to validate against
 * @returns The workspace response if validation succeeds, null otherwise
 */
export async function getFlinkWorkspace(
  params: FlinkWorkspaceParams,
): Promise<GetWsV1Workspace200Response | null> {
  // 1. Verify we have a signed-in CCloud session
  if (!hasCCloudAuthSession()) {
    logger.trace("No CCloud auth session, cannot fetch workspace");
    return null;
  }

  try {
    await getCCloudAuthSession({ createIfNone: true });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "User did not consent to login." || error.name === "CCloudConnectionError")
    ) {
      return null; // User cancelled - silent exit
    }
    throw error; // Unexpected errors get logged
  }

  const sidecar = await getSidecar();

  // Parse provider and region from the region string
  // Expected format: "provider.region" like "aws.us-east-1"
  // Fallback: If no provider prefix, default to "aws" (most common for Confluent Cloud)
  let provider: string;
  let region: string;

  if (params.region.includes(".")) {
    // Format: "provider.region"
    const [providerPart, ...regionParts] = params.region.split(".");
    provider = providerPart;
    region = regionParts.join(".");
  } else {
    // Format: just "region" - default to AWS
    provider = "aws";
    region = params.region;
    logger.debug("Region parameter missing provider prefix, defaulting to AWS", {
      originalRegion: params.region,
      inferredProvider: provider,
    });
  }

  if (!provider || !region) {
    logger.error("Invalid region format after parsing", {
      originalRegion: params.region,
      parsedProvider: provider,
      parsedRegion: region,
    });
    return null;
  }

  const providerRegion: IEnvProviderRegion = {
    environmentId: params.environmentId as EnvironmentId,
    provider,
    region,
  };

  const workspacesApi = sidecar.getFlinkWorkspacesWsV1Api(providerRegion);

  let workspace: GetWsV1Workspace200Response;
  try {
    workspace = await workspacesApi.getWsV1Workspace({
      organization_id: params.organizationId,
      environment_id: params.environmentId,
      name: params.workspaceName,
    });

    logger.debug(`Fetched workspace: ${params.workspaceName}`, {
      organizationId: workspace.organization_id,
      environmentId: workspace.environment_id,
    });
  } catch (error) {
    logError(error, "Failed to fetch Flink workspace", {
      extra: {
        environmentId: params.environmentId,
        organizationId: params.organizationId,
        workspaceName: params.workspaceName,
      },
    });
    return null;
  }

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

  // Note: Region validation is not needed because the Flink Workspaces API is region-scoped.
  // When we query with a specific region, the API only returns workspaces from that region.
  // Additionally, workspace.spec.compute_pool is an EnvScopedObjectReference that does not
  // contain a region field.

  return workspace;
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

  // Build document header with workspace metadata
  const header = [
    `-- Flink SQL Workspace: ${params.workspaceName}`,
    `-- Environment ID: ${params.environmentId}`,
    `-- Region: ${params.region}`,
    `-- Organization ID: ${params.organizationId}`,
    "",
  ].join("\n");

  // If no statements found, show a single empty document
  if (sqlStatements.length === 0) {
    try {
      const document = await vscode.workspace.openTextDocument({
        language: FLINK_SQL_LANGUAGE_ID,
        content: `${header}-- No SQL statements found in workspace`,
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
