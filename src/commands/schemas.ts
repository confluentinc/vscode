import { homedir } from "os";
import path from "path";
import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import { fetchSchemaBody, SchemaDocumentProvider } from "../documentProviders/schema";
import { Logger } from "../logging";
import { ContainerTreeItem } from "../models/main";
import { Schema } from "../models/schema";
import { SchemaRegistry } from "../models/schemaRegistry";
import { KafkaTopic } from "../models/topic";
import { ResourceLoader } from "../storage/resourceLoader";
import { getSchemasViewProvider } from "../viewProviders/schemas";
import { uploadNewSchema } from "./schemaUpload";

const logger = new Logger("commands.schemas");

export function registerSchemaCommands(): vscode.Disposable[] {
  return [
    registerCommandWithLogging("confluent.schemaViewer.refresh", refreshCommand),
    registerCommandWithLogging("confluent.schemaViewer.validate", validateCommand),
    registerCommandWithLogging("confluent.schemas.upload", uploadNewSchema),
    registerCommandWithLogging("confluent.schemas.evolve", evolveSchema),
    registerCommandWithLogging("confluent.schemaViewer.viewLocally", viewLocallyCommand),
    registerCommandWithLogging("confluent.schemas.copySchemaRegistryId", copySchemaRegistryId),
    registerCommandWithLogging("confluent.topics.openlatestschemas", openLatestSchemasCommand),
    registerCommandWithLogging(
      "confluent.schemas.diffMostRecentVersions",
      diffLatestSchemasCommand,
    ),
  ];
}

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
  const schemaRegistry: SchemaRegistry | undefined = getSchemasViewProvider().schemaRegistry;
  if (!schemaRegistry) {
    return;
  }
  await vscode.env.clipboard.writeText(schemaRegistry.id);
  vscode.window.showInformationMessage(`Copied "${schemaRegistry.id}" to clipboard.`);
}

// refer to https://github.com/confluentinc/vscode/pull/420 for reverting changes to package.json for
// the following three commands:
function refreshCommand(item: any) {
  logger.info("item", item);
  // TODO: implement this
}

function validateCommand(item: any) {
  logger.info("item", item);
  // TODO: implement this
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

/**
 * Command run against a schema to:
 *  1. Download to a temp file
 *  2. Associate that URL with the schema registry and subject
 *  3. Open the file in a new editor tab
 * */
async function evolveSchema(schema: Schema) {
  if (!(schema instanceof Schema)) {
    logger.error("evolveSchema called with invalid argument type", schema);
    return;
  }

  // Open up an new temp buffer, but with the schema data in the query string.
  // (That schema data will provide defaults for the 'schema upload' command
  // later on down the line, see `uploadNewSchema`.

  const parentDir = vscode.workspace.workspaceFolders?.[0].uri.fsPath || homedir();
  const editSchemaUri = vscode.Uri.from({
    scheme: "untitled",
    path: path.join(parentDir, `${schema.subject}.${schema.fileExtension()}`),
    query: encodeURIComponent(JSON.stringify(schema)),
  });

  // Search for an existing open document with the same URI. Well, almost.
  // The existing one may be under either file:// or untitled://, so we need to check both.
  const untitledString = editSchemaUri.toString();
  const fileString = editSchemaUri.with({ scheme: "file" }).toString();

  const existing = vscode.workspace.textDocuments.find((doc) => {
    const docUriString = doc.uri.toString();
    logger.info("Comparing URIs", docUriString, untitledString, fileString);
    return docUriString === untitledString || docUriString === fileString;
  });

  let document: vscode.TextDocument;
  let editor: vscode.TextEditor;
  // We can't open the same URI twice, so just focus the existing one.
  if (existing) {
    logger.info("Found existing document for schema", schema.subject);
    editor = await vscode.window.showTextDocument(existing, { preview: false });
    document = existing;
  } else {
    document = await vscode.workspace.openTextDocument(editSchemaUri);
    editor = await vscode.window.showTextDocument(editSchemaUri, { preview: false });
  }

  // Fetch the schema body content from the schema registry.
  const schemaBody = await fetchSchemaBody(schema);

  if (existing) {
    // Empty the existing document...
    const edit = new vscode.WorkspaceEdit();
    edit.delete(editSchemaUri, new vscode.Range(0, 0, document.lineCount, 0));
    await vscode.workspace.applyEdit(edit);
  }

  // Write the current schema content to the document
  const edit = new vscode.WorkspaceEdit();
  edit.insert(editSchemaUri, new vscode.Position(0, 0), schemaBody);
  await vscode.workspace.applyEdit(edit);

  // Set the language of the editor based on the schema type.
  await setEditorLanguageForSchema(editor, schema);
}

/**
 * Convert a {@link Schema} to a URI and render via the {@link SchemaDocumentProvider} as a read-
 * only document in a new editor tab.
 */
async function loadOrCreateSchemaViewer(schema: Schema): Promise<vscode.TextEditor> {
  const uri: vscode.Uri = new SchemaDocumentProvider().resourceToUri(schema, schema.fileName());
  const textDoc = await vscode.window.showTextDocument(uri, { preview: false });

  await setEditorLanguageForSchema(textDoc, schema);

  return textDoc;
}

/** Possibly set the language of the editor's document based on the schema. W */
async function setEditorLanguageForSchema(textDoc: vscode.TextEditor, schema: Schema) {
  const installedLanguages = await vscode.languages.getLanguages();
  logger.info("Available languages", installedLanguages);
  logger.info("Schema languages", schema.languageTypes());

  for (const language of schema.languageTypes()) {
    if (installedLanguages.indexOf(language) !== -1) {
      vscode.languages.setTextDocumentLanguage(textDoc.document, language);
      logger.info(`Set document language to ${language} for schema ${schema.subject}`);
      return;
    } else {
      logger.warn(`Language ${language} not installed for schema ${schema.subject}`);
    }
  }

  logger.warn("Could not find a matching language for schema ${schema.subject}");
}

/**
 * Get the highest versioned schema(s) related to a single topic from the schema registry.
 * May return two schemas if the topic has both key and value schemas.
 */
export async function getLatestSchemasForTopic(topic: KafkaTopic): Promise<Schema[]> {
  if (!topic.hasSchema) {
    throw new Error(`Asked to get schemas for topic "${topic.name}" believed to not have schemas.`);
  }

  const loader = ResourceLoader.getInstance(topic.connectionId);

  const schemaRegistry = await loader.getSchemaRegistryForEnvironmentId(topic.environmentId);
  if (!schemaRegistry) {
    throw new CannotLoadSchemasError(
      `Could not determine schema registry for topic "${topic.name}" believed to have related schemas.`,
    );
  }

  const allSchemas = await loader.getSchemasForRegistry(schemaRegistry);

  if (allSchemas.length === 0) {
    throw new CannotLoadSchemasError(
      `Schema registry "${schemaRegistry.id}" had no schemas, but we expected it to have some for topic "${topic.name}"`,
    );
  }

  // Filter for schemas related to this topic.
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
