import * as vscode from "vscode";
import type { GetWsV1Workspace200Response } from "../clients/flinkWorkspaces";
import { flinkWorkspaceUri } from "../emitters";
import { logError } from "../errors";
import { CCloudResourceLoader } from "../loaders/ccloudResourceLoader";
import { Logger } from "../logging";
import type { CCloudEnvironment } from "../models/environment";
import type { CCloudFlinkComputePool } from "../models/flinkComputePool";
import type { CCloudFlinkDbKafkaCluster } from "../models/kafkaCluster";
import { showErrorNotificationWithButtons } from "../notifications";
import type { QuickPickItemWithValue } from "../quickpicks/types";
import { createEnhancedQuickPick } from "../quickpicks/utils/quickPickUtils";
import { logUsage, UserEvent } from "../telemetry/events";
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
 * Represents a SQL statement extracted from a workspace block,
 * including optional description metadata from block properties.
 */
export interface ExtractedSqlStatement {
  statement: string;
  description?: string;
}

/** Error thrown when Flink workspace URI is missing required parameters. */
export class FlinkWorkspaceUriError extends Error {
  constructor(public readonly missingParams: string[]) {
    super(`Flink workspace URI missing required parameters: ${missingParams.join(", ")}`);
    this.name = "FlinkWorkspaceUriError";
  }
}

/**
 * Handle a flinkWorkspace URI event by creating and opening a .flink.sql file.
 * Validates the workspace exists before creating the file, then extracts metadata
 * from the workspace to set on opened documents.
 *
 * @param uri The URI containing workspace parameters
 */
export async function handleFlinkWorkspaceUriEvent(uri: vscode.Uri): Promise<void> {
  logger.debug("Handling Flink workspace URI event", { uri: uri.toString() });

  let params: FlinkWorkspaceParams;
  try {
    params = extractWorkspaceParamsFromUri(uri);
  } catch (error) {
    if (error instanceof FlinkWorkspaceUriError) {
      logError(error, "Invalid Flink workspace URI");
      logUsage(UserEvent.FlinkWorkspaceUriAction, {
        status: "invalid URI",
        missingParams: error.missingParams.join(","),
      });
      await showErrorNotificationWithButtons(
        `Invalid Flink workspace link: missing required parameters (${error.missingParams.join(", ")}). Please use a complete workspace link from Confluent Cloud.`,
      );
      return;
    }
    throw error;
  }

  const loader = CCloudResourceLoader.getInstance();
  const workspace = await loader.getFlinkWorkspace(params);
  if (!workspace) {
    logUsage(UserEvent.FlinkWorkspaceUriAction, {
      status: "workspace not found",
    });
    await showErrorNotificationWithButtons(
      `Unable to load Flink workspace: ${params.workspaceName}. Please verify the workspace exists and you have access.`,
    );
    return;
  }

  const metadataContext = await extractMetadataFromWorkspace(workspace);

  const sqlStatements = extractSqlStatementsFromWorkspace(workspace);

  if (sqlStatements.length === 0) {
    logUsage(UserEvent.FlinkWorkspaceUriAction, {
      status: "no statements found",
    });
    const document = await vscode.workspace.openTextDocument({
      language: FLINK_SQL_LANGUAGE_ID,
      content: `No Flink SQL statements were found in this workspace.`,
    });
    await setFlinkDocumentMetadata(document.uri, metadataContext);
    await vscode.window.showTextDocument(document);
    return;
  }

  // Show selection dialog for user to choose which statements to open
  const selectedStatements = await selectSqlStatementsForOpening(sqlStatements);
  if (!selectedStatements || selectedStatements.length === 0) {
    logger.debug("User cancelled statement selection or selected no statements");
    logUsage(UserEvent.FlinkWorkspaceUriAction, {
      status: "selection cancelled",
    });
    return;
  }

  try {
    await openSqlStatementsAsDocuments(selectedStatements, metadataContext);
    logUsage(UserEvent.FlinkWorkspaceUriAction, {
      status: "documents opened",
      totalStatements: sqlStatements.length,
      selectedStatements: selectedStatements.length,
    });
  } catch (error) {
    logError(error, "Failed to open Flink SQL statements as documents");
    logUsage(UserEvent.FlinkWorkspaceUriAction, {
      status: "open documents failed",
      error: error instanceof Error ? error.message : String(error),
    });
    await showErrorNotificationWithButtons(
      `Failed to open Flink SQL workspace: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Extract Flink workspace parameters from a URI's query string.
 * @param uri The URI containing workspace parameters in its query string
 * @returns Parsed workspace parameters
 * @throws {FlinkWorkspaceUriError} If required parameters are missing
 */
export function extractWorkspaceParamsFromUri(uri: vscode.Uri): FlinkWorkspaceParams {
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
    throw new FlinkWorkspaceUriError(missingParams);
  }

  return requiredParams as FlinkWorkspaceParams;
}

/**
 * Extract metadata context from a workspace response for setting on opened documents.
 * Resolves the compute pool ID from workspace.spec.compute_pool to full CCloudFlinkComputePool,
 * uses the environment as the Flink catalog, and extracts database from workspace properties.
 *
 * @param workspace The workspace response from the API
 * @returns Metadata context with resolved resources
 */
export async function extractMetadataFromWorkspace(
  workspace: GetWsV1Workspace200Response,
): Promise<WorkspaceMetadataContext> {
  const context: WorkspaceMetadataContext = {};

  const environmentId = workspace.environment_id;
  if (!environmentId) {
    logError(new Error("Workspace missing environment_id"), "Cannot extract metadata");
    return context;
  }

  const loader = CCloudResourceLoader.getInstance();
  const environments = await loader.getEnvironments(true);
  const environment = environments.find((env) => env.id === environmentId);
  if (!environment) {
    logError(
      new Error(`Environment ${environmentId} not found`),
      "Cannot extract metadata from workspace",
    );
    return context;
  }

  context.catalog = environment;

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
 * Each block contains code_options.source array of SQL lines and optional properties.
 *
 * @param workspace The workspace containing SQL blocks
 * @returns Array of extracted SQL statements with optional descriptions
 */
export function extractSqlStatementsFromWorkspace(
  workspace: GetWsV1Workspace200Response,
): ExtractedSqlStatement[] {
  const sqlStatements: ExtractedSqlStatement[] = [];

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
      sqlStatements.push({
        statement: sqlStatement,
        description: block.properties?.description,
      });
    }
  }

  logger.debug(`Extracted ${sqlStatements.length} SQL statements from workspace`);
  return sqlStatements;
}

/**
 * Shows a quickpick dialog allowing the user to select which SQL statements to open.
 * All statements are pre-selected by default.
 * @param sqlStatements Array of extracted SQL statements to choose from
 * @returns Promise that resolves to selected statement strings, or undefined if cancelled
 */
export async function selectSqlStatementsForOpening(
  sqlStatements: ExtractedSqlStatement[],
): Promise<string[] | undefined> {
  const quickPickItems: QuickPickItemWithValue<string>[] = sqlStatements.map(
    (extracted, index) => ({
      label: `Cell ${index + 1}:`,
      description: extracted.statement.trim().replace(/\s+/g, " "),
      value: extracted.statement,
      detail: extracted.description ? `Description: ${extracted.description}` : undefined,
    }),
  );

  const result = await createEnhancedQuickPick(quickPickItems, {
    title: "Select Flink SQL Statements to Open",
    placeHolder: "Select statements to open as documents (all selected by default)",
    canSelectMany: true,
    ignoreFocusOut: true,
    matchOnDescription: true,
    matchOnDetail: true,
    selectedItems: quickPickItems,
  });

  if (result.selectedItems.length === 0) {
    return undefined;
  }

  return result.selectedItems
    .map((item) => item.value)
    .filter((value): value is string => value !== undefined);
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
