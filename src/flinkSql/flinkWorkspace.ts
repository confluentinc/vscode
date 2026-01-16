import type { Uri } from "vscode";
import * as vscode from "vscode";
import type { GetWsV1Workspace200Response } from "../clients/flinkWorkspaces";
import { flinkWorkspaceUri } from "../emitters";
import { logError } from "../errors";
import { CCloudResourceLoader } from "../loaders/ccloudResourceLoader";
import { Logger } from "../logging";
import type { CCloudEnvironment } from "../models/environment";
import type { CCloudFlinkComputePool } from "../models/flinkComputePool";
import type { CCloudFlinkDbKafkaCluster } from "../models/kafkaCluster";
import type { EnvironmentId } from "../models/resource";
import { showErrorNotificationWithButtons } from "../notifications";
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
 * Handle a flinkWorkspace URI event by creating and opening a .flink.sql file.
 * Validates the workspace exists before creating the file, then extracts metadata
 * from the workspace to set on opened documents.
 *
 * @param uri The URI containing workspace parameters
 */
export async function handleFlinkWorkspaceUriEvent(uri: Uri): Promise<void> {
  logger.debug("Handling Flink workspace URI event", { uri: uri.toString() });

  const params = extractWorkspaceParamsFromUri(uri);

  const loader = CCloudResourceLoader.getInstance();
  const workspace = await loader.getFlinkWorkspace(params as FlinkWorkspaceParams);
  if (!workspace) {
    await showErrorNotificationWithButtons(
      `Unable to load Flink workspace: ${params?.workspaceName}. Please verify the workspace exists and you have access.`,
    );
    return;
  }
  const environment = await loader.getEnvironment(params?.environmentId as EnvironmentId, true);
  if (!environment) {
    await showErrorNotificationWithButtons(
      `Unable to load environment: ${params?.environmentId}. Please verify the environment exists and you have access.`,
    );
    return;
  }

  const metadataContext = await extractMetadataFromWorkspace(
    workspace,
    environment as CCloudEnvironment,
  );

  const sqlStatements = extractSqlStatementsFromWorkspace(workspace);

  if (sqlStatements.length === 0) {
    const document = await vscode.workspace.openTextDocument({
      language: FLINK_SQL_LANGUAGE_ID,
      content: `No Flink SQL statements were found in this workspace.`,
    });
    await setFlinkDocumentMetadata(document.uri, metadataContext);
    await vscode.window.showTextDocument(document);
    return;
  }

  try {
    await openSqlStatementsAsDocuments(sqlStatements, metadataContext);
  } catch (error) {
    logError(error, "Failed to open Flink SQL statements as documents");
    await showErrorNotificationWithButtons(
      `Failed to open Flink SQL workspace: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
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

  const requiredParams = { environmentId, organizationId, workspaceName, provider, region };
  const missingParams = Object.entries(requiredParams)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missingParams.length > 0) {
    logError(
      new Error("Missing required Flink workspace URI parameters"),
      `URI missing parameters: ${missingParams.join(", ")}`,
    );
    return null;
  }

  return requiredParams as FlinkWorkspaceParams;
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
  const context: WorkspaceMetadataContext = {
    catalog: environment,
  };

  const computePoolId = workspace.spec.compute_pool?.id ?? undefined;

  if (computePoolId) {
    const computePool = environment.flinkComputePools.find((pool) => pool.id === computePoolId);
    if (computePool) {
      context.computePool = computePool;
    } else {
      logError(
        new Error(
          `Compute pool ${computePoolId} from workspace not found in environment ${environment.id}`,
        ),
        "Compute pool not found",
      );
    }
  }

  const databaseId = workspace.spec.properties?.["sql-database"];

  if (databaseId) {
    const loader = CCloudResourceLoader.getInstance();
    const kafkaClusters = await loader.getKafkaClustersForEnvironmentId(environment.id);

    const cluster = kafkaClusters?.find((c) => c.id === databaseId);
    if (cluster && cluster.isFlinkable()) {
      context.database = cluster;
    }
  }

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

    const sqlStatement = block.code_options.source.join("\n");
    if (sqlStatement.trim()) {
      sqlStatements.push(sqlStatement);
    }
  }

  logger.debug(`Extracted ${sqlStatements.length} SQL statements from workspace`);
  return sqlStatements;
}

/**
 * Open SQL statements as VS Code documents and apply workspace metadata.
 *
 * @param sqlStatements Array of SQL statement strings to open as documents
 * @param metadataContext Optional metadata to set on each opened document
 */
export async function openSqlStatementsAsDocuments(
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
