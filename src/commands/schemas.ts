import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import { SchemaDocumentProvider } from "../documentProviders/schema";
import { Logger } from "../logging";
import { Schema } from "../models/schema";
import { SchemaRegistryCluster } from "../models/schemaRegistry";
import { getSchemasViewProvider } from "../viewProviders/schemas";

const logger = new Logger("commands.schemas");

async function viewLocallyCommand(schema: Schema) {
  if (!(schema instanceof Schema)) {
    logger.error("viewLocallyCommand called with invalid argument type", schema);
    return;
  }
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Loading schema "${schema.subject}"...`,
    },
    async () => {
      await loadOrCreateSchemaViewer(schema);
    },
  );
}

/** Copy the Schema Registry cluster ID from the Schemas tree provider nav action. */
async function copySchemaRegistryId() {
  const cluster: SchemaRegistryCluster | null = getSchemasViewProvider().schemaRegistry;
  if (!cluster) {
    return;
  }
  await vscode.env.clipboard.writeText(cluster.id);
  vscode.window.showInformationMessage(`Copied "${cluster.id}" to clipboard.`);
}

function refreshCommand(item: any) {
  logger.info("item", item);
  vscode.window.showInformationMessage(
    "COMING SOON: Refreshing schema content is not yet supported.",
  );
}

function validateCommand(item: any) {
  logger.info("item", item);
  vscode.window.showInformationMessage(
    "COMING SOON: Validating schema content is not yet supported.",
  );
}

function uploadVersionCommand(item: any) {
  logger.info("item", item);
  vscode.window.showInformationMessage(
    "COMING SOON: Uploading new version to Schema Registry is not yet supported.",
  );
}

export const commands = [
  registerCommandWithLogging("confluent.schemaViewer.refresh", refreshCommand),
  registerCommandWithLogging("confluent.schemaViewer.validate", validateCommand),
  registerCommandWithLogging("confluent.schemaViewer.uploadVersion", uploadVersionCommand),
  registerCommandWithLogging("confluent.schemaViewer.viewLocally", viewLocallyCommand),
  registerCommandWithLogging("confluent.schemas.copySchemaRegistryId", copySchemaRegistryId),
];

/**
 * Convert a {@link Schema} to a URI and render via the {@link SchemaDocumentProvider} as a read-
 * only document in a new editor tab.
 */
async function loadOrCreateSchemaViewer(schema: Schema) {
  const uri: vscode.Uri = new SchemaDocumentProvider().resourceToUri(schema, schema.fileName());
  const textDoc = await vscode.window.showTextDocument(uri, { preview: false });
  // VSCode may "throw" an error from `workbench.*.main.js` like `Unknown language: avsc` if the
  // workspace doesn't have an extension that supports the "avsc" extension/language (or similar).
  // There isn't anything we can do to suppress those errors (like wrapping the line below in try/catch),
  // but they don't show up to the user unless they look at the "Window" output channel.
  vscode.languages.setTextDocumentLanguage(textDoc.document, schema.fileExtension());
  return textDoc;
}
