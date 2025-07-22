import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import { ResponseError } from "../clients/sidecar";
import {
  fetchSchemaBody,
  openReadOnlySchemaDocument,
  SCHEMA_URI_SCHEME,
  setLanguageForSchemaEditor,
} from "../documentProviders/schema";
import { schemaSubjectChanged, schemaVersionsChanged } from "../emitters";
import { logError } from "../errors";
import { ResourceLoader } from "../loaders";
import { Logger } from "../logging";
import { Schema, type SchemaType, Subject } from "../models/schema";
import { SchemaRegistry } from "../models/schemaRegistry";
import { KafkaTopic } from "../models/topic";
import {
  DEFAULT_ERROR_NOTIFICATION_BUTTONS,
  showErrorNotificationWithButtons,
} from "../notifications";
import { schemaSubjectQuickPick, schemaTypeQuickPick } from "../quickpicks/schemas";
import { uriQuickpick } from "../quickpicks/uris";
import { hashed, logUsage, UserEvent } from "../telemetry/events";
import { getEditorOrFileContents, LoadedDocumentContent } from "../utils/file";
import { getSchemasViewProvider } from "../viewProviders/schemas";
import {
  confirmSchemaSubjectDeletion,
  confirmSchemaVersionDeletion,
  hardDeletionQuickPick,
  showHardDeleteWarningModal,
} from "./utils/schemaManagement/deletion";
import {
  CannotLoadSchemasError,
  chooseSubject,
  determineDraftSchemaUri,
  determineLatestSchema,
  determineSchemaType,
  documentHasErrors,
  getLatestSchemasForTopic,
  uploadSchema,
} from "./utils/schemaManagement/upload";

const logger = new Logger("commands.schemas");

export function registerSchemaCommands(): vscode.Disposable[] {
  return [
    registerCommandWithLogging("confluent.schemas.create", createSchemaCommand),
    registerCommandWithLogging("confluent.schemas.upload", uploadSchemaFromFileCommand),
    registerCommandWithLogging(
      "confluent.schemas.uploadForSubject",
      uploadSchemaForSubjectFromFileCommand,
    ),
    registerCommandWithLogging("confluent.schemas.evolveSchemaSubject", evolveSchemaSubjectCommand),
    registerCommandWithLogging("confluent.schemas.evolve", evolveSchemaCommand),
    registerCommandWithLogging("confluent.schemaViewer.viewLocally", viewLocallyCommand),
    registerCommandWithLogging(
      "confluent.schemaViewer.viewLatestLocally",
      viewLatestLocallyCommand,
    ),
    registerCommandWithLogging(
      "confluent.schemas.copySchemaRegistryId",
      copySchemaRegistryIdCommand,
    ),
    registerCommandWithLogging("confluent.schemas.copySubject", copySubjectCommand),
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
export async function viewLocallyCommand(schema: Schema) {
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
      await openReadOnlySchemaDocument(schema);
    },
  );
}

/** Copy the Schema Registry ID from the Schemas tree provider nav action. */
export async function copySchemaRegistryIdCommand() {
  const schemaRegistry: SchemaRegistry | null = getSchemasViewProvider().schemaRegistry;
  if (!schemaRegistry) {
    return;
  }
  await vscode.env.clipboard.writeText(schemaRegistry.id);
  vscode.window.showInformationMessage(`Copied "${schemaRegistry.id}" to clipboard.`);
}

/** Copy the subject name to the clipboard from the Subject tree item in the Topics or Schemas views. */
export async function copySubjectCommand(subject: Subject) {
  if (!subject || typeof subject.name !== "string") {
    return;
  }
  await vscode.env.clipboard.writeText(subject.name);
  vscode.window.showInformationMessage(`Copied subject name "${subject.name}" to clipboard.`);
}

/** Open a new editor and set its language to one of the supported Schema types. */
export async function createSchemaCommand() {
  const chosenSchemaType = await schemaTypeQuickPick();
  if (!chosenSchemaType) {
    return;
  }

  const document = await vscode.workspace.openTextDocument({
    language: chosenSchemaType,
  });

  // set the language mode based on the schema type
  const editor = await vscode.window.showTextDocument(document.uri, { preview: false });
  await setLanguageForSchemaEditor(editor, chosenSchemaType);
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
export async function openLatestSchemasCommand(topic: KafkaTopic) {
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
        openReadOnlySchemaDocument(schema);
      });
      await Promise.all(promises);
    },
  );
}

/** Drop into read-only viewing the latest version of the schema in the subject group.  */
export async function viewLatestLocallyCommand(subject: Subject) {
  if (!(subject instanceof Subject)) {
    return;
  }
  const schema: Schema = await determineLatestSchema(subject);
  await viewLocallyCommand(schema);
}

/**
 * Command to evolve a single schema (should be the most revent version in a schema subject group).
 * This will create a new untitled document with the schema body and set up the
 * file uri with the schema data in the query string for future reference by the
 * upload schema command, allowing to default to the originating schema registr
 * and subject.
 **/
export async function evolveSchemaCommand(schema: Schema) {
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
  await setLanguageForSchemaEditor(editor, schema.type);

  // The user can edit, then either save to disk or to use the 'cloud upload' button
  // to upload to the schema registry. Because of the query string in the URI,
  // the upload schema command will be able to default to the originating
  // schema registry and subject.
}

/** Drop into evolving the latest version of the schema in the subject group. */
export async function evolveSchemaSubjectCommand(subject: Subject) {
  if (!(subject instanceof Subject)) {
    return;
  }
  const schema: Schema = await determineLatestSchema(subject);
  await evolveSchemaCommand(schema);
}

/**
 * Delete a single schema version.
 *
 * If was the last version bound to the subject, the subject will disappear also.
 *
 */
export async function deleteSchemaVersionCommand(schema: Schema) {
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
        // not a 404, something unexpected
        logError(e, "Error fetching schemas for subject while deleting schema version", {
          extra: { error: {} },
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

  // Show the input box to confirm the deletion based on the version number or the subject name
  const confirmation = await confirmSchemaVersionDeletion(hardDelete, schema, schemaGroup);
  if (!confirmation) {
    logger.debug("User canceled schema version deletion.");
    return;
  }

  if (hardDelete) {
    const finalConfirm = await showHardDeleteWarningModal("schema version");
    if (!finalConfirm) {
      logger.debug("User canceled schema version hard deletion at warning modal.");
      return;
    }
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
    logger.info(successMessage);
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
    logError(e, "Error deleting schema version", { extra: { error: {} } });
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

/**
 * Delete a schema subject, which may contain multiple schema versions.
 * If the subject is deleted, all versions will be deleted.
 */
export async function deleteSchemaSubjectCommand(subject: Subject) {
  if (subject === undefined) {
    // shoup: only used by E2E tests until https://github.com/confluentinc/vscode/issues/1875 is done
    const schemaViewProvider = getSchemasViewProvider();
    const registry = schemaViewProvider.schemaRegistry!;
    if (!registry) {
      logger.error("Could not determine schema registry");
      return;
    }

    let subjectName: string | undefined = await schemaSubjectQuickPick(
      registry,
      false,
      "Choose a subject to delete",
    );
    if (!subjectName) {
      logger.error("Could not determine schema subject");
      return;
    }

    subject = new Subject(
      subjectName,
      registry.connectionId,
      registry.environmentId,
      registry.schemaRegistryId,
    );
  }

  if (!(subject instanceof Subject)) {
    logger.error("deleteSchemaSubjectCommand called with invalid argument type", subject);
    return;
  }

  const loader = ResourceLoader.getInstance(subject.connectionId);
  let schemaGroup: Schema[] | null = null;

  // Ensure it still exits.
  try {
    schemaGroup = await loader.getSchemasForSubject(subject.environmentId, subject.name);

    if (!Array.isArray(schemaGroup) || schemaGroup.length === 0) {
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
          extra: { error: {} },
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

  if (hardDelete) {
    const finalConfirm = await showHardDeleteWarningModal("schema subject");
    if (!finalConfirm) {
      logger.debug("User canceled schema subject hard deletion at warning modal.");
      return;
    }
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
    logError(e, "Error deleting schema subject", { extra: { error: {} } });
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
 * Wrapper around {@linkcode uploadSchemaFromFileCommand}, triggered from:
 *  1. A Subject from the Schemas view
 *  2. On one of a topic's subjects in the Topics view
 */
export async function uploadSchemaForSubjectFromFileCommand(subject: Subject) {
  if (!(subject instanceof Subject)) {
    return;
  }
  const loader = ResourceLoader.getInstance(subject.connectionId);
  const registry = await loader.getSchemaRegistryForEnvironmentId(subject.environmentId);
  await uploadSchemaFromFileCommand(registry, subject.name);
}

/**
 * Command backing "Upload a new schema" action, triggered either from a Schema Registry item in the
 * Resources view or the nav action in the Schemas view (with a Schema Registry selected).
 *
 * Instead of starting from a file/editor and trying to attach the SR+subject info, we start from the
 * Schema Registry and then ask for the file/editor (and schema subject if not provided).
 */
export async function uploadSchemaFromFileCommand(
  registry?: SchemaRegistry,
  subjectString?: string,
) {
  // prompt for the editor/file first via the URI quickpick, only allowing a subset of URI schemes,
  // editor languages, and file extensions
  const uriSchemes = ["file", "untitled", SCHEMA_URI_SCHEME];
  const languageIds = ["plaintext", "avroavsc", "protobuf", "proto3", "json"];
  const fileFilters = {
    "Schema files": ["avsc", "avro", "json", "proto"],
  };
  const schemaUri: vscode.Uri | undefined = await uriQuickpick(
    uriSchemes,
    languageIds,
    fileFilters,
  );
  if (!schemaUri) {
    return;
  }

  // If the document has (locally marked) errors, don't proceed.
  if (await documentHasErrors(schemaUri)) {
    // (error notification shown in the above function, no need to do anything else here)
    logger.error("Document has errors, aborting schema upload");
    return;
  }

  const docContent: LoadedDocumentContent = await getEditorOrFileContents(schemaUri);

  // What kind of schema is this? We must tell the schema registry.
  const schemaType: SchemaType | undefined = await determineSchemaType(
    schemaUri,
    docContent.openDocument?.languageId,
  );
  if (!schemaType) {
    // the only way we get here is if the user bailed on the schema type quickpick after we failed
    // to figure out what the type was (due to lack of language ID supporting extensions or otherwise)
    return;
  }

  if (!(registry instanceof SchemaRegistry)) {
    // the only way we get here is if the user clicked the action in the Schemas view nav area, so
    // we need to get the focused schema registry
    const schemaViewProvider = getSchemasViewProvider();
    registry = schemaViewProvider.schemaRegistry!;
  }
  if (!registry) {
    logger.error("Could not determine schema registry");
    return;
  }

  subjectString = subjectString ? subjectString : await chooseSubject(registry);
  if (!subjectString) {
    logger.error("Could not determine schema subject");
    return;
  }

  // TODO after #951: grab the subject group and / or the most recent schema binding
  // to the subject to ensure is the right type. Error out if not. This error
  // will be more clear than the one that the schema registry will give us.

  await uploadSchema(registry, subjectString, schemaType, docContent.content);
}
