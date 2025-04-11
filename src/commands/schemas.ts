import { homedir } from "os";
import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import { ResponseError } from "../clients/sidecar";
import { fetchSchemaBody, SchemaDocumentProvider } from "../documentProviders/schema";
import { schemaSubjectChanged, schemaVersionsChanged } from "../emitters";
import {
  DEFAULT_ERROR_NOTIFICATION_BUTTONS,
  logError,
  showErrorNotificationWithButtons,
} from "../errors";
import { ResourceLoader } from "../loaders";
import { Logger } from "../logging";
import { getLanguageTypes, Schema, SchemaType, Subject } from "../models/schema";
import { SchemaRegistry } from "../models/schemaRegistry";
import { KafkaTopic } from "../models/topic";
import { schemaTypeQuickPick } from "../quickpicks/schemas";
import { hashed, logUsage, UserEvent } from "../telemetry/events";
import { fileUriExists } from "../utils/file";
import { getSchemasViewProvider } from "../viewProviders/schemas";
import { uploadSchemaForSubjectFromfile, uploadSchemaFromFile } from "./schemaUpload";
import {
  confirmSchemaSubjectDeletion,
  confirmSchemaVersionDeletion,
  hardDeletionQuickPick,
} from "./utils/schemas";

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
    registerCommandWithLogging("confluent.schemas.deleteSubject", deleteSchemaSubjectCommand),
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

/**
 * Delete a single schema version.
 *
 * If was the last version bound to the subject, the subject will disappear also.
 *
 */
async function deleteSchemaVersionCommand(schema: Schema) {
  if (!(schema instanceof Schema)) {
    logger.error("deleteSchemaVersionCommand called with invalid argument type", schema);
    return;
  }

  const loader = ResourceLoader.getInstance(schema.connectionId);
  let schemaGroup: Schema[] | null = null;
  try {
    schemaGroup = await loader.getSchemasForSubject(schema.environmentId!, schema.subject);

    // Ensure is still present in the registry / UI view gestured from wasn't stale.
    const found = schemaGroup && schemaGroup.find((s) => s.id === schema.id) !== undefined;

    if (!found) {
      showErrorNotificationWithButtons("Schema not found in registry.", {
        "Refresh Schemas": () => vscode.commands.executeCommand("confluent.schemas.refresh"),
        ...DEFAULT_ERROR_NOTIFICATION_BUTTONS,
      });
      logger.error(
        `Schema version ${schema.version} not found in registry, cannot delete.`,
        schemaGroup,
      );
      return;
    }
  } catch (e) {
    if (e instanceof ResponseError) {
      // If the whole subject is gone, we will get a 404. Say, last version
      // already deleted in other workspace or other means?
      if (e.response.status !== 404) {
        // not a 404, something unexpected/
        logError(e, "Error fetching schemas for subject while deleting schema version", {
          extra: { subject: schema.subject },
        });
      }
    }

    showErrorNotificationWithButtons("Schema not found in registry.", {
      "Refresh Schemas": () => vscode.commands.executeCommand("confluent.schemas.refresh"),
      ...DEFAULT_ERROR_NOTIFICATION_BUTTONS,
    });
    logger.error(`Error fetching schema version ${schema.version}, cannot delete.`, e);
    return;
  }

  // Determine if user wants to hard or soft delete.
  const hardDelete = await hardDeletionQuickPick("Schema Version");
  if (hardDelete === undefined) {
    logger.debug("User canceled schema version deletion.");
    return;
  }

  // Ask if they are sure they want to delete the schema version.
  const confirmation = await confirmSchemaVersionDeletion(hardDelete, schema, schemaGroup);

  if (!confirmation) {
    logger.debug("User canceled schema version deletion.");
    return;
  }

  let success = true;

  // Drive the delete via the resource loader so will be cache consistent.
  // Resource loader will also emit event to alert views to refresh if needed.
  try {
    const wasOnlyVersionForSubject = schemaGroup.length === 1;

    // Delete the schema version. Will take care of clearing any internal
    // caches.
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Deleting schema ...",
      },
      async () => {
        await loader.deleteSchemaVersion(schema, hardDelete, wasOnlyVersionForSubject);
      },
    );

    let successMessage = `Version ${schema.version} of subject ${schema.subject} deleted.`;
    if (wasOnlyVersionForSubject) {
      successMessage += ` Subject ${schema.subject} deleted.`;
    }
    vscode.window.showInformationMessage(successMessage);

    // Fire off event to update views if needed.
    if (wasOnlyVersionForSubject) {
      // Announce that the entire subject was deleted.
      schemaSubjectChanged.fire({ change: "deleted", subject: schema.subjectObject() });
    } else {
      // Announce that a schema version was deleted, and provide the updated schema group.

      // Filter out the deleted schema version from the pre-delete
      // fetched schema group.
      const newSubject = schema.subjectWithSchemasObject(
        schemaGroup.filter((s) => s.id !== schema.id),
      );

      schemaVersionsChanged.fire({ change: "deleted", subject: newSubject });
    }
  } catch (e) {
    success = false;
    logError(e, "Error deleting schema version", { extra: { subject: schema.subject } });
    showErrorNotificationWithButtons(
      `Error deleting schema version ${schema.version}: ${e instanceof Error ? e.message : String(e)}`,
    );
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

async function deleteSchemaSubjectCommand(subject: Subject) {
  if (!(subject instanceof Subject)) {
    logger.error("deleteSchemaSubjectCommand called with invalid argument type", subject);
    return;
  }

  const loader = ResourceLoader.getInstance(subject.connectionId);
  let schemaGroup: Schema[] | null = null;

  // Ensure it still exits.
  try {
    schemaGroup = await loader.getSchemasForSubject(subject.environmentId, subject.name);

    if (!schemaGroup) {
      showErrorNotificationWithButtons("Schema subject not found in registry.", {
        "Refresh Schemas": () => vscode.commands.executeCommand("confluent.schemas.refresh"),
        ...DEFAULT_ERROR_NOTIFICATION_BUTTONS,
      });
      logger.error(`Schema subject ${subject.name} not found in registry, cannot delete.`);
      return;
    }
  } catch (e) {
    if (e instanceof ResponseError) {
      // If the whole subject is gone, we will get a 404. Say, last version
      // already deleted in other workspace or other means?
      if (e.response.status !== 404) {
        // not a 404, something unexpected/
        logError(e, "Error fetching schemas for subject while deleting schema subject", {
          extra: { subject: subject.name },
        });
      }
    }
    showErrorNotificationWithButtons("Schema subject not found in registry.", {
      "Refresh Schemas": () => vscode.commands.executeCommand("confluent.schemas.refresh"),
      ...DEFAULT_ERROR_NOTIFICATION_BUTTONS,
    });
    logger.error(`Error fetching schema subject ${subject.name}, cannot delete.`, e);
    return;
  }

  // Determine if user wants to hard or soft delete.
  const hardDelete = await hardDeletionQuickPick("Schema Subject");
  if (hardDelete === undefined) {
    logger.debug("User canceled schema subject deletion.");
    return;
  }

  let confirmation: boolean | undefined;

  if (schemaGroup.length > 1) {
    // Wordier confirmation message for deleting multiple schema versions.
    confirmation = await confirmSchemaSubjectDeletion(hardDelete, subject, schemaGroup);
  } else {
    // If just one schema version, then defer to confirmSchemaVersionDeletion for simpler
    // confirmation experience deleting the single version in the subject.
    confirmation = await confirmSchemaVersionDeletion(hardDelete, schemaGroup[0], schemaGroup);
  }

  if (!confirmation) {
    logger.debug("User canceled schema subject deletion.");
    return;
  }

  logger.info("Deleting schema subject", subject.name);

  let success = true;

  try {
    const message =
      schemaGroup.length > 1
        ? `Deleting ${schemaGroup.length} schema versions in ${subject.name}...`
        : `Deleting single version schema subject "${subject.name}"...`;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: message,
      },
      async () => {
        await loader.deleteSchemaSubject(subject, hardDelete);
      },
    );

    const adjective = hardDelete ? "hard" : "soft";
    const versionCount =
      schemaGroup.length > 1 ? `${schemaGroup.length} schema versions` : "single schema version";
    vscode.window.showInformationMessage(
      `Subject ${subject.name} and ${versionCount} ${adjective} deleted.`,
    );
  } catch (e) {
    success = false;
    logError(e, "Error deleting schema subject", { extra: { subject: subject.name } });
    showErrorNotificationWithButtons(
      `Error deleting schema subject ${subject.name}: ${e instanceof Error ? e.message : String(e)}`,
    );
  } finally {
    // Inform views that the entire subject was either totally or possibly partially deleted.
    // (if deleteSchemaSubject() throws, we're in an indeterminate state, so be conservative
    //  instead of possibly lying).
    schemaSubjectChanged.fire({ change: "deleted", subject: subject });
  }

  logUsage(UserEvent.SchemaAction, {
    action: "delete schema subject",
    status: success ? "succeeded" : "failed",

    connection_id: subject.connectionId,
    connection_type: subject.connectionType,
    environment_id: subject.environmentId,

    schema_registry_id: subject.schemaRegistryId,
    schema_type: schemaGroup[0].type,
    subject_hash: hashed(subject.name),
    count_schema_versions_deleted: schemaGroup.length,
  });
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
