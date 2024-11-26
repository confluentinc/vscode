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

  // First, going to need to save the schema to a file.

  // What directory to default the save dialog to?
  // If there's an open document in the active editor, use that directory.
  // Otherwise, use the first workspace folder,
  // Finally, use the user's home directory.
  const activeEditor = vscode.window.activeTextEditor;
  const activeDir = activeEditor?.document.uri.fsPath;
  const baseDir = activeDir || vscode.workspace.workspaceFolders?.[0].uri.fsPath || homedir();

  // Ask the user for a save location, and fetch the schema body concurrently.
  const [saveLocation, schemaBody]: [vscode.Uri | undefined, string] = await Promise.all([
    vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(
        path.join(baseDir, `${schema.subject}.${schema.fileExtension()}`),
      ),
      filters: { "Schema Files": [schema.fileExtension()] },
    }),
    fetchSchemaBody(schema),
  ]);

  if (!saveLocation) {
    // show a canceled message
    vscode.window.showInformationMessage("Schema evolution canceled: no save location selected.");
    return;
  }

  // Open up an new buffer from that path, but with the schema data in the query string.
  // (That schema data will provide defaults for the 'schema upload' command
  // later on down the line, see `uploadNewSchema`.
  const editSchemaFileUri = vscode.Uri.from({
    scheme: "file",
    path: saveLocation.fsPath,
    query: encodeURIComponent(JSON.stringify(schema)),
  });

  logger.info(`User selected ${editSchemaFileUri.fsPath}`);

  let editSchemaUri: vscode.Uri = editSchemaFileUri;

  // If file does not exist, then we're clear to make an untitled scheme URL.
  // Otherwise, we'll use the path given, but we'll update the contents in the opened editor
  // so that the editor will smell dirty, but they haven't hit disk yet.
  try {
    await vscode.workspace.fs.stat(editSchemaFileUri);
    logger.info("File exists, running with it.");
  } catch (e) {
    logger.info("File does not exist, creating untitled scheme URL");
    editSchemaUri = vscode.Uri.from({
      scheme: "untitled",
      path: editSchemaFileUri.path,
      query: editSchemaFileUri.query,
    });
  }

  let document: vscode.TextDocument;
  let editor: vscode.TextEditor;
  document = await vscode.workspace.openTextDocument(editSchemaUri);
  editor = await vscode.window.showTextDocument(editSchemaUri, { preview: false });

  logger.info(`Opened ${editSchemaUri.toString()} in editor`);

  // Empty the existing document if need be.
  if (document.getText()) {
    const edit = new vscode.WorkspaceEdit();
    edit.delete(editSchemaUri, new vscode.Range(0, 0, document.lineCount, 0));
    await vscode.workspace.applyEdit(edit);
    logger.info("Cleared existing document contents in editor");
  }

  // Write the current schema content to the document
  const edit = new vscode.WorkspaceEdit();
  edit.insert(editSchemaUri, new vscode.Position(0, 0), schemaBody);
  await vscode.workspace.applyEdit(edit);
  logger.info("Wrote schema content to document in editor");

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
