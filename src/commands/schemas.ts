import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import { SchemaDocumentProvider } from "../documentProviders/schema";
import { Logger } from "../logging";
import { Schema } from "../models/schema";
import { SchemaRegistry } from "../models/schemaRegistry";
import { KafkaTopic } from "../models/topic";
import { ResourceManager } from "../storage/resourceManager";
import { getSchemasViewProvider } from "../viewProviders/schemas";
import { ContainerTreeItem } from "../models/main";

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

/** Copy the Schema Registry ID from the Schemas tree provider nav action. */
async function copySchemaRegistryId() {
  const schemaRegistry: SchemaRegistry | null = getSchemasViewProvider().schemaRegistry;
  if (!schemaRegistry) {
    return;
  }
  await vscode.env.clipboard.writeText(schemaRegistry.id);
  vscode.window.showInformationMessage(`Copied "${schemaRegistry.id}" to clipboard.`);
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

/** Diff the most recent two versions of schemas bound to a subject. */
export async function diffLatestSchemasCommand(schemaGroup: ContainerTreeItem<Schema>) {
  if (schemaGroup.children.length < 2) {
    // Should not happen if the context value was set correctly over in generateSchemaSubjectGroups().
    logger.warn("diffLatestSchemasCommand called with less than two schemas", schemaGroup);
    return;
  }

  // generateSchemaSubjectGroups() will have set up `children` in reverse order ([0] is highest version).
  const latestSchema = schemaGroup.children[0];
  const priorVersionSchema = schemaGroup.children[1];

  logger.info(
    `Comparing most recent schema versions, subject ${latestSchema.subject}, versions (${latestSchema.version}, ${priorVersionSchema.version})`,
  );

  // Select the latest, then compare against the prior version.
  await vscode.commands.executeCommand("confluent.diff.selectForCompare", priorVersionSchema);
  await vscode.commands.executeCommand("confluent.diff.compareWithSelected", latestSchema);
}

async function openLatestSchemasCommand(topic: KafkaTopic) {
  let highestVersionedSchemas: Schema[] | null = null;

  try {
    highestVersionedSchemas = await getLatestSchemasForTopic(topic);
  } catch (e) {
    if (e instanceof CannotLoadSchemasError) {
      logger.error(e.message);
      vscode.window.showErrorMessage(e.message);
      return;
    } else {
      throw e;
    }
  }

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
    registerCommandWithLogging(
      "confluent.schemas.diffMostRecentVersions",
      diffLatestSchemasCommand,
    ),
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
  // These two checks indicate programming errors, not a user or external system contents issues ...
  if (!topic.hasSchema) {
    throw new Error(`Asked to get schemas for topic "${topic.name}" believed to not have schemas.`);
  }

  // local topics, at time of writing, won't have any related schemas, 'cause we don't support any form
  // of local schema registry (yet). But when supporting local schema registry will probably need a different
  // way to get schemas than these ccloud-infected methods, so raise an error here as a reminder to revisit
  // this code when local schema registry support is added.
  if (topic.isLocalTopic()) {
    throw new Error(
      `Asked to get schemas for local topic "${topic.name}", but local topics should not have schemas.`,
    );
  }

  const rm = ResourceManager.getInstance();

  const schemaRegistry = await rm.getCCloudSchemaRegistry(topic.environmentId!);
  if (schemaRegistry === null) {
    throw new CannotLoadSchemasError(
      `Could not determine schema registry for topic "${topic.name}" believed to have related schemas.`,
    );
  }

  const allSchemas = await rm.getSchemasForRegistry(schemaRegistry.id);

  if (allSchemas === undefined || allSchemas.length === 0) {
    throw new CannotLoadSchemasError(
      `Schema registry "${schemaRegistry.id}" had no schemas, but we expected it to have some for topic "${topic.name}"`,
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
    throw new CannotLoadSchemasError(`No schemas found for topic "${topic.name}"!`);
  }

  // Return flattend values from the map, the list of highest-versioned schemas related to the topic.
  return [...nameToHighestVersion.values()];
}

/** Raised when unexpectedly could not load schema(s) for a topic we previously believed
 * had related schemas. Message will be informative and user-facing.
 */
export class CannotLoadSchemasError extends Error {
  constructor(message: string) {
    super(message);
  }
}
