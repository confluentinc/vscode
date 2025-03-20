import { homedir } from "os";
import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import { fetchSchemaBody, SchemaDocumentProvider } from "../documentProviders/schema";
import { logError } from "../errors";
import { ResourceLoader } from "../loaders";
import { Logger } from "../logging";
import { getLanguageTypes, Schema, SchemaType, Subject } from "../models/schema";
import { SchemaRegistry } from "../models/schemaRegistry";
import { KafkaTopic } from "../models/topic";
import { schemaTypeQuickPick } from "../quickpicks/schemas";
import { hashed, logUsage, UserEvent } from "../telemetry/events";
import { getSchemasViewProvider } from "../viewProviders/schemas";
import { uploadSchemaForSubjectFromfile, uploadSchemaFromFile } from "./schemaUpload";

const logger = new Logger("commands.schemas");

export function registerSchemaCommands(): vscode.Disposable[] {
  return [
    registerCommandWithLogging("confluent.schemas.create", createSchemaCommand),
    registerCommandWithLogging("confluent.schemas.upload", uploadSchemaFromFile),
    registerCommandWithLogging(
      "confluent.schemas.uploadForSubject",
      uploadSchemaForSubjectFromfile,
    ),
    registerCommandWithLogging("confluent.schemas.evolveSchemaSubject", evolveSchemaSubjectCommand),
    registerCommandWithLogging("confluent.schemas.evolve", evolveSchemaCommand),
    registerCommandWithLogging("confluent.schemaViewer.viewLocally", viewLocallyCommand),
    registerCommandWithLogging(
      "confluent.schemaViewer.viewLatestLocally",
      viewLatestLocallyCommand,
    ),
    registerCommandWithLogging("confluent.schemas.copySchemaRegistryId", copySchemaRegistryId),
    registerCommandWithLogging("confluent.topics.openlatestschemas", openLatestSchemasCommand),
    registerCommandWithLogging(
      "confluent.schemas.diffMostRecentVersions",
      diffLatestSchemasCommand,
    ),
    registerCommandWithLogging("confluent.schemas.deleteVersion", deleteSchemaVersionCommand),
  ];
}

/**
 * Load a schema into a new editor tab for viewing, wrapped with a progress window
 * (during the schema fetch).
 */
async function viewLocallyCommand(schema: Schema) {
  if (!(schema instanceof Schema)) {
    logger.error("viewLocallyCommand called with invalid argument type", schema);
    return;
  }
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Loading schema "${schema.subject}" v${schema.version}...`,
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

/** User has gestured to create a new schema from scratch relative to the currently selected schema registry. */
async function createSchemaCommand() {
  const chosenSchemaType = await schemaTypeQuickPick();
  if (!chosenSchemaType) {
    logger.info("User canceled schema type selection.");
    return;
  }

  const document = await vscode.workspace.openTextDocument({
    language: chosenSchemaType,
  });

  // set the language mode based on the schema type
  const editor = await vscode.window.showTextDocument(document.uri, { preview: false });
  await setEditorLanguageForSchema(editor, chosenSchemaType);
}

/** Diff the most recent two versions of schemas bound to a subject. */
export async function diffLatestSchemasCommand(subjectWithSchemas: Subject) {
  if (!subjectWithSchemas.schemas || subjectWithSchemas.schemas.length < 2) {
    // Should not happen if the context value was set correctly over in getSchemasForSubject().
    logger.warn("diffLatestSchemasCommand called with less than two schemas", subjectWithSchemas);
    return;
  }

  // getSchemasForSubject() will have set up `children` in reverse order ([0] is highest version).
  const latestSchema = subjectWithSchemas.schemas[0];
  const priorVersionSchema = subjectWithSchemas.schemas[1];

  logger.info(
    `Comparing most recent schema versions, subject ${latestSchema.subject}, versions (${latestSchema.version}, ${priorVersionSchema.version})`,
  );

  // Select the latest, then compare against the prior version.
  await vscode.commands.executeCommand("confluent.diff.selectForCompare", priorVersionSchema);
  await vscode.commands.executeCommand("confluent.diff.compareWithSelected", latestSchema);
}

/** Read-only view the latest schema version(s) related to a topic. */
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

/** Drop into read-only viewing the latest version of the schema in the subject group.  */
async function viewLatestLocallyCommand(subject: Subject) {
  const schema: Schema = await determineLatestSchema("viewLatestLocallyCommand", subject);
  await viewLocallyCommand(schema);
}

/**
 * Get the latest schema from a subject, possibly fetching from the schema registry if needed.
 * @param subjectish
 * @returns
 */
export async function determineLatestSchema(callpoint: string, subject: Subject): Promise<Schema> {
  if (!(subject instanceof Subject)) {
    const msg = `${callpoint} called with invalid argument type`;
    logger.error(msg, subject);
    throw new Error(msg);
  }

  if (subject.schemas) {
    // Is already carrying schemas (as from when the subject coming from topics view)
    return subject.schemas[0];
  } else {
    // Must promote the subject to its subject group, then get the first (latest) schema.
    const loader = ResourceLoader.getInstance(subject.connectionId);
    const schemaGroup = await loader.getSchemasForSubject(subject.environmentId, subject.name);
    return schemaGroup[0];
  }
}

/**
 * Command to evolve a single schema (should be the most revent version in a schema subject group).
 * This will create a new untitled document with the schema body and set up the
 * file uri with the schema data in the query string for future reference by the
 * upload schema command, allowing to default to the originating schema registr
 * and subject.
 **/
async function evolveSchemaCommand(schema: Schema) {
  if (!(schema instanceof Schema)) {
    logger.error("evolveSchema called with invalid argument type", schema);
    return;
  }

  // Go get the schema.
  const schemaBody = await fetchSchemaBody(schema);

  // Get an untitled scheme URI corresponding the the schema that has no file path currently
  // (so that if they opt save to disk, it won't fail -- untitleds cannot supplant file:// schema documents).
  const evolveSchemaUri = await determineDraftSchemaUri(schema);

  // Initialize the editor with the current schema body.
  const edit = new vscode.WorkspaceEdit();
  edit.insert(evolveSchemaUri, new vscode.Position(0, 0), schemaBody);
  await vscode.workspace.applyEdit(edit);

  // Load the evolve schema URI into an editor.
  const editor = await vscode.window.showTextDocument(evolveSchemaUri, { preview: false });

  // Finally, set the language of the editor based on the schema type.
  await setEditorLanguageForSchema(editor, schema.type);

  // The user can edit, then either save to disk or to use the 'cloud upload' button
  // to upload to the schema registry. Because of the query string in the URI,
  // the upload schema command will be able to default to the originating
  // schema registry and subject.
}

/** Drop into evolving the latest version of the schema in the subject group. */
async function evolveSchemaSubjectCommand(subject: Subject) {
  const schema: Schema = await determineLatestSchema("evolveSchemaSubjectCommand", subject);

  await evolveSchemaCommand(schema);
}

async function deleteSchemaVersionCommand(schema: Schema) {
  if (!(schema instanceof Schema)) {
    logger.error("deleteSchemaVersionCommand called with invalid argument type", schema);
    return;
  }

  // deterimine if hard or soft delete to perform
  const strenthStr = await vscode.window.showQuickPick(
    [
      "Soft Delete -- existing records will remain deserializable",
      "Hard Delete -- any existing records will NOT be deserializable",
    ],
    {
      title: "Delete Schema Version",
      placeHolder: "Select the type of delete to perform",
    },
  );

  if (!strenthStr) {
    // show message
    vscode.window.showErrorMessage("Schema deletion canceled.");
    logger.info("User canceled schema version deletion.");
    return;
  }
  const hardDelete = strenthStr.startsWith("Hard");

  const loader = ResourceLoader.getInstance(schema.connectionId);

  const deleteAdverb = hardDelete ? "HARD " : "";
  const title = `${deleteAdverb}Delete Schema Version ${schema.version}?`;

  const [validator, placeholder] = getSchemaDeletionValidatorAndPlaceholder(
    schema.version,
    hardDelete,
  );
  const confirmation = await vscode.window.showInputBox({
    title: title,
    prompt: await getDeleteSchemaVersionPrompt(hardDelete, schema, loader),
    validateInput: validator,
    placeHolder: placeholder,
  });

  if (!confirmation || validator(confirmation) !== undefined) {
    vscode.window.showErrorMessage("Schema deletion canceled.");
    logger.info("User canceled schema version deletion.");
    return;
  }

  let success = true;

  // Drive the delete via the resource loader so will be cache consistent.
  // Resource loader will also emit event to alert views to refresh if needed.
  try {
    // await loader.deleteSchemaVersion(schema, hardDelete);
    vscode.window.showInformationMessage(`Schema version ${schema.version} deleted.`);
  } catch (e) {
    success = false;
    logError(e, "Error deleting schema version", undefined, true);
    if (e instanceof Error) {
      vscode.window.showErrorMessage(
        `Error deleting schema version ${schema.version}: ${e.message}`,
      );
    } else {
      vscode.window.showErrorMessage(`Error deleting schema version ${schema.version}: ${e}`);
    }
  }

  logUsage(UserEvent.SchemaAction, {
    action: "delete schema version",
    status: success ? "succeeded" : "failed",

    connection_id: schema.connectionId,
    connection_type: schema.connectionType,
    environment_id: schema.environmentId,

    schema_registry_id: schema.schemaRegistryId,
    schema_type: schema.type,
    subject_hash: hashed(schema.subject),
    schema_version: schema.version,
  });
}

/**
 * Determine the prompt to show when deleting a schema version.
 * @param hardDeletion Is a hard delete going to be performed?
 * @param schema The Schema/version to delete.
 * @param loader ResourceLoader to use to get the schema group.
 * @returns Customized prompt for the delete action.
 */
async function getDeleteSchemaVersionPrompt(
  hardDeletion: boolean,
  schema: Schema,
  loader: ResourceLoader,
): Promise<string> {
  const schemaGroup = await loader.getSchemasForSubject(schema.environmentId!, schema.subject);
  const isOnlyVersion = schemaGroup.length === 1;

  const deleteVerb = (hardDeletion ? "hard" : "soft") + " delete";
  let prompt: string;

  if (isOnlyVersion) {
    prompt = `Are you sure you want to ${deleteVerb} the only version of subject ${schema.subject}?`;
  } else {
    const isLatestVersion = schema.version === schemaGroup[0].version;
    if (isLatestVersion) {
      prompt = `Are you sure you want to ${deleteVerb} the latest version of subject ${schema.subject}? Version ${schemaGroup[1].version} will become the latest.`;
    } else {
      prompt = `Are you sure you want to ${deleteVerb} version ${schema.version} of subject ${schema.subject}?`;
    }
  }

  return prompt;
}

type ValidationFunction = (input: string) => vscode.InputBoxValidationMessage | undefined;
/**
 * Returns a pair:
 *  [0]: Function that can be used to validate the confirmation input for a schema version for deletion.
 *  [1]: The string to show in the input box as a placeholder.
 * @param version The version to confirm.
 * @param hardDeletion Whether this is for a hard deletion or not.
 * @returns pair of [validation function, prompt string]
 */
function getSchemaDeletionValidatorAndPlaceholder(
  version: number,
  hardDeletion: boolean,
): [ValidationFunction, string] {
  let validator: ValidationFunction;
  let prompt: string;

  if (hardDeletion) {
    prompt = `Enter "hard v${version}" to confirm, escape to cancel.`;
    validator = (input: string) => {
      if (input === `hard v${version}`) {
        return;
      }
      return {
        message: `Enter "hard v${version}" to confirm hard deletion, escape to cancel.`,
        severity: vscode.InputBoxValidationSeverity.Error,
      };
    };
  } else {
    prompt = `Enter "v${version}" to confirm, escape to cancel.`;
    validator = (input: string) => {
      if (input === `v${version}`) {
        return;
      }
      return {
        message: `Enter "v${version}" to confirm, escape to cancel.`,
        severity: vscode.InputBoxValidationSeverity.Error,
      };
    };
  }

  return [validator, prompt];
}

/**
 * Return a URI for a draft schema file that does not exist in the filesystem corresponding to a draft
 * next version of the given schema. The URI will have an untitled scheme and the schema data encoded
 * in the query string for future reference.
 **/
async function determineDraftSchemaUri(schema: Schema): Promise<vscode.Uri> {
  const activeEditor = vscode.window.activeTextEditor;
  const activeDir = activeEditor?.document.uri.fsPath;
  const baseDir = activeDir || vscode.workspace.workspaceFolders?.[0].uri.fsPath || homedir();

  // Now loop through draft file:// uris until we find one that doesn't exist.,
  let chosenFileUri: vscode.Uri | null = null;
  let draftNumber = -1;
  while (!chosenFileUri || (await fileUriExists(chosenFileUri))) {
    draftNumber += 1;
    const draftFileName = schema.nextVersionDraftFileName(draftNumber);
    chosenFileUri = vscode.Uri.parse("file://" + `${baseDir}/${draftFileName}`);

    if (draftNumber > 15) {
      throw new Error(
        `Could not find a draft file URI that does not exist in the filesystem after 15 tries.`,
      );
    }
  }

  // Now respell to be unknown scheme and add the schema data to the query string,
  // will become the default schema data for the upload schema command.
  return vscode.Uri.from({
    ...chosenFileUri,
    scheme: "untitled",
    query: encodeURIComponent(JSON.stringify(schema)),
  });
}

/** Check if a file URI exists in the filesystem. */
async function fileUriExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/**
 * Convert a {@link Schema} to a URI and render via the {@link SchemaDocumentProvider} as a read-
 * only document in a new editor tab.
 */
async function loadOrCreateSchemaViewer(schema: Schema): Promise<vscode.TextEditor> {
  const uri: vscode.Uri = new SchemaDocumentProvider().resourceToUri(schema, schema.fileName());
  const textDoc = await vscode.window.showTextDocument(uri, { preview: false });

  await setEditorLanguageForSchema(textDoc, schema.type);

  return textDoc;
}

/**
 * Possibly set the language of the editor's document based on the schema.
 * Depends on what languages the user has installed.
 */
async function setEditorLanguageForSchema(textDoc: vscode.TextEditor, type: SchemaType) {
  const installedLanguages = await vscode.languages.getLanguages();

  const languageTypes = getLanguageTypes(type);

  for (const language of languageTypes) {
    if (installedLanguages.indexOf(language) !== -1) {
      vscode.languages.setTextDocumentLanguage(textDoc.document, language);
      logger.debug(`Set document language to "${language}"`);
      return;
    } else {
      logger.warn(`Language ${language} not installed type ${type}`);
    }
  }

  const preferredLanguage = languageTypes[0];
  const marketplaceUrl = `https://marketplace.visualstudio.com/search?term=${preferredLanguage}&target=VSCode&category=All%20categories&sortBy=Relevance`;
  vscode.window.showWarningMessage(
    `Could not find a matching editor language for "${type}". Try again after installing [an extension that supports "${preferredLanguage}"](${marketplaceUrl}).`,
  );

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

  const topicSchemaGroups = await loader.getTopicSubjectGroups(topic);

  if (topicSchemaGroups.length === 0) {
    throw new CannotLoadSchemasError(`Topic "${topic.name}" has no related schemas in registry.`);
  }

  // Return array of the highest versioned schemas. They
  // will be the first schema in each subject group per return contract
  // of getTopicSubjectGroups().
  return topicSchemaGroups.map((sg) => sg.schemas![0]);
}

/**
 * Raised when unexpectedly could not load schema(s) for a topic we previously believed
 * had related schemas. Message will be informative and user-facing.
 */
export class CannotLoadSchemasError extends Error {
  constructor(message: string) {
    super(message);
  }
}
