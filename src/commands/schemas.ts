import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import { SchemaDocumentProvider } from "../documentProviders/schema";
import { Logger } from "../logging";
import { Schema } from "../models/schema";
import { SchemaRegistryCluster } from "../models/schemaRegistry";
import { getSchemasViewProvider } from "../viewProviders/schemas";
import { KafkaTopic } from "../models/topic";
import { ResourceManager } from "../storage/resourceManager";

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

async function openLatestSchemasCommand(topic: KafkaTopic) {
  const highestVersionedSchemas = await getLatestSchemasForTopic(topic);

  // Make a nice message to show in the progress bar, albeit short lived.
  const schemaSubjectVersionList = highestVersionedSchemas
    .map((s) => `${s.subject} (${s.version})`)
    .join(", ");
  const maybe_ess = highestVersionedSchemas.length > 1 ? "s" : "";
  const message = `Opening latest schema${maybe_ess} for topic "${topic.name}": "${schemaSubjectVersionList}"`;

  logger.info(message);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: message,
    },
    async () => {
      const promises = highestVersionedSchemas.map((schema) => {
        loadOrCreateSchemaViewer(schema);
      });
      await Promise.all(promises);
    },
  );
}

export function registerSchemaCommands(): vscode.Disposable[] {
  return [
    registerCommandWithLogging("confluent.schemaViewer.refresh", refreshCommand),
    registerCommandWithLogging("confluent.schemaViewer.validate", validateCommand),
    registerCommandWithLogging("confluent.schemaViewer.uploadVersion", uploadVersionCommand),
    registerCommandWithLogging("confluent.schemaViewer.viewLocally", viewLocallyCommand),
    registerCommandWithLogging("confluent.schemas.copySchemaRegistryId", copySchemaRegistryId),
    registerCommandWithLogging("confluent.topics.openlatestschemas", openLatestSchemasCommand),
  ];
}

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

/**
 * Get the highest versioned schema(s) related to a single topic from the schema registry
 * as decided by TopicNameStrategy. May return two schemas if the topic has both key and value schemas.
 */
export async function getLatestSchemasForTopic(topic: KafkaTopic): Promise<Schema[]> {
  if (topic.isLocalTopic()) {
    throw new Error("Cannot get schemas for local topics (yet)");
  }

  if (!topic.hasSchema) {
    throw new Error("Wacky: asked to get schemas for a topic believed to not have schemas.");
  }

  const rm = ResourceManager.getInstance();

  const schemaRegistry = await rm.getCCloudSchemaRegistryCluster(topic.environmentId!);
  if (schemaRegistry === null) {
    throw new Error("Wacky: could not determine schema registry for a topic with known schemas.");
  }

  const allSchemas = await rm.getSchemasForRegistry(schemaRegistry.id);

  if (allSchemas === undefined || allSchemas.length === 0) {
    throw new Error(
      `Wacky: schema registry ${schemaRegistry.id} had no schemas, but we highly expected them`,
    );
  }

  // Filter by TopicNameStrategy for this topic.
  const topicSchemas = allSchemas.filter((schema) => schema.matchesTopicName(topic.name));

  // Now make map of schema subject -> highest version'd schema for said subject
  const nameToHighestVersion = new Map<string, Schema>();
  for (const schema of topicSchemas) {
    const existing = nameToHighestVersion.get(schema.subject);
    if (existing === undefined || existing.version < schema.version) {
      nameToHighestVersion.set(schema.subject, schema);
    }
  }

  if (nameToHighestVersion.size === 0) {
    throw new Error(`No schemas found for topic "${topic.name}", but highly expected them`);
  }

  // Return flattend values from the map, the list of highest-versioned schemas related to the topic.
  return [...nameToHighestVersion.values()];
}
