import type { Uri } from "vscode";
import * as vscode from "vscode";
import { getCCloudAuthSession } from "../authn/utils";
import type { GetWsV1Workspace200Response } from "../clients/flinkWorkspaces";
import { flinkWorkspaceUri } from "../emitters";
import { CCloudResourceLoader } from "../loaders/ccloudResourceLoader";
import { Logger } from "../logging";
import type { CCloudEnvironment } from "../models/environment";
import type { CCloudFlinkComputePool } from "../models/flinkComputePool";
import type { CCloudFlinkDbKafkaCluster } from "../models/kafkaCluster";
import type { EnvironmentId } from "../models/resource";
import { FLINK_SQL_LANGUAGE_ID } from "./constants";
import { setFlinkDocumentMetadata } from "./statementUtils";

const logger = new Logger("flinkSql.flinkWorkspace");

/**
 * Interface for Flink workspace parameters extracted from a URI.
 * Provider and region are required since the Flink Workspaces API is region-scoped.
 */
export interface FlinkWorkspaceParams {
  environmentId: string;
  organizationId: string;
  workspaceName: string;
  provider: string;
  region: string;
}

/**
 * Metadata context extracted from a Flink workspace for setting on opened documents.
 * Contains the resolved CCloud resources (environment as catalog, database, compute pool)
 * that should be associated with documents opened from this workspace.
 */
export interface WorkspaceMetadataContext {
  catalog?: CCloudEnvironment;
  database?: CCloudFlinkDbKafkaCluster;
  computePool?: CCloudFlinkComputePool;
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
  const provider = params.get("provider");
  const region = params.get("region");

  if (!environmentId || !organizationId || !workspaceName || !provider || !region) {
    logger.warn("Missing required workspace parameters in URI", {
      environmentId,
      organizationId,
      workspaceName,
      provider,
      region,
    });
    return null;
  }

  return {
    environmentId,
    organizationId,
    workspaceName,
    provider,
    region,
  };
}

/**
 * Fetch and validate a Flink workspace from the API.
 * Ensures CCloud authentication before delegating to the resource loader.
 *
 * @param params Workspace parameters to validate against
 * @returns The workspace response if validation succeeds, null otherwise
 */
export async function getFlinkWorkspace(
  params: FlinkWorkspaceParams,
): Promise<GetWsV1Workspace200Response | null> {
  // Ensure we have a signed-in CCloud session (prompts login if needed)
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

  // Delegate to the resource loader for the actual workspace fetching
  const loader = CCloudResourceLoader.getInstance();
  return loader.getFlinkWorkspace(params);
}

/**
 * Extract metadata context from a workspace response for setting on opened documents.
 * Resolves the compute pool ID from workspace.spec.compute_pool to full CCloudFlinkComputePool,
 * uses the environment as the Flink catalog, and extracts database from workspace properties.
 *
 * @param workspace The workspace response from the API
 * @param environment The environment containing this workspace (used as catalog)
 * @returns Metadata context with resolved resources
 */
export async function extractMetadataFromWorkspace(
  workspace: GetWsV1Workspace200Response,
  environment: CCloudEnvironment,
): Promise<WorkspaceMetadataContext> {
  logger.debug("Extracting metadata from workspace", {
    workspaceName: workspace.name,
    environmentId: environment.id,
    environmentName: environment.name,
    workspaceProperties: workspace.spec.properties,
  });

  const context: WorkspaceMetadataContext = {
    catalog: environment,
  };

  // Extract compute pool ID and resolve to full model
  const computePoolId = (workspace.spec.compute_pool as { id?: string } | null)?.id;
  if (computePoolId) {
    const computePool = environment.flinkComputePools.find((pool) => pool.id === computePoolId);
    if (computePool) {
      context.computePool = computePool;
      logger.debug("Resolved compute pool from workspace", { computePoolId });
    } else {
      logger.warn("Compute pool from workspace not found in environment", {
        computePoolId,
        environmentId: environment.id,
      });
    }
  }

  // Extract database (Kafka cluster ID) from workspace properties
  const databaseId = workspace.spec.properties?.["sql-database"];
  logger.debug("Extracting database from workspace", {
    databaseId,
    hasProperties: !!workspace.spec.properties,
  });

  if (databaseId) {
    const loader = CCloudResourceLoader.getInstance();
    const kafkaClusters = await loader.getKafkaClustersForEnvironmentId(environment.id);
    logger.debug("Loaded Kafka clusters for environment", {
      environmentId: environment.id,
      clusterCount: kafkaClusters?.length ?? 0,
      clusterIds: kafkaClusters?.map((c) => c.id) ?? [],
    });

    const cluster = kafkaClusters?.find((c) => c.id === databaseId);
    if (cluster && cluster.isFlinkable()) {
      context.database = cluster;
      logger.debug("Resolved database from workspace properties", { databaseId });
    } else if (cluster) {
      logger.warn("Database cluster found but not Flink-enabled", {
        databaseId,
        environmentId: environment.id,
        flinkPoolCount: cluster.flinkPools?.length ?? 0,
      });
    } else {
      logger.warn("Database from workspace properties not found in loaded clusters", {
        databaseId,
        environmentId: environment.id,
      });
    }
  }

  logger.debug("Extracted metadata context", {
    hasCatalog: !!context.catalog,
    catalogId: context.catalog?.id,
    hasDatabase: !!context.database,
    databaseId: context.database?.id,
    hasComputePool: !!context.computePool,
    computePoolId: context.computePool?.id,
  });

  return context;
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
 * Validates the workspace exists before creating the file, then extracts metadata
 * from the workspace to set on opened documents.
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

  // Load environment to use as catalog and for resolving metadata
  // Force deep refresh to ensure we have the latest compute pools and Kafka clusters
  const loader = CCloudResourceLoader.getInstance();
  const environment = await loader.getEnvironment(params.environmentId as EnvironmentId, true);
  if (!environment) {
    vscode.window.showErrorMessage(
      `Unable to load environment: ${params.environmentId}. Please verify the environment exists and you have access.`,
    );
    return;
  }

  // Extract metadata from workspace for setting on opened documents
  const metadataContext = await extractMetadataFromWorkspace(
    workspace,
    environment as CCloudEnvironment,
  );

  // Extract SQL statements from the workspace
  const sqlStatements = extractSqlStatementsFromWorkspace(workspace);

  // If no statements found, show a single empty document with metadata
  if (sqlStatements.length === 0) {
    try {
      const document = await vscode.workspace.openTextDocument({
        language: FLINK_SQL_LANGUAGE_ID,
        content: `-- No SQL statements found in workspace --`,
      });
      await setFlinkDocumentMetadata(document.uri, metadataContext);
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
    await openSqlStatementsAsDocuments(sqlStatements, metadataContext);
  } catch (error) {
    vscode.window.showErrorMessage(
      `Failed to open Flink SQL workspace: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Open SQL statements as VS Code documents and apply workspace metadata.
 *
 * @param sqlStatements Array of SQL statement strings to open as documents
 * @param metadataContext Optional metadata to set on each opened document
 */
async function openSqlStatementsAsDocuments(
  sqlStatements: string[],
  metadataContext?: WorkspaceMetadataContext,
): Promise<void> {
  for (const statement of sqlStatements) {
    const document = await vscode.workspace.openTextDocument({
      language: FLINK_SQL_LANGUAGE_ID,
      content: statement,
    });

    // Set metadata on document before showing (triggers language client config)
    if (metadataContext) {
      await setFlinkDocumentMetadata(document.uri, metadataContext);
    }

    await vscode.window.showTextDocument(document, { preview: false });
  }
}

/**
 * Register a handler for the flinkWorkspaceUri event emitter.
 * @returns A Disposable that unregisters the handler when disposed
 */
export function setFlinkWorkspaceListener(): vscode.Disposable {
  return flinkWorkspaceUri.event(handleFlinkWorkspaceUriEvent);
}
