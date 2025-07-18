import { homedir } from "os";
import * as vscode from "vscode";
import {
  type RegisterRequest,
  ResponseError,
  type SchemasV1Api,
  type SubjectsV1Api,
  type SubjectVersion,
} from "../../../clients/schemaRegistryRest";
import { schemaSubjectChanged, schemaVersionsChanged } from "../../../emitters";
import { ResourceLoader } from "../../../loaders";
import { Logger } from "../../../logging";
import { Schema, SchemaType, Subject } from "../../../models/schema";
import { type SchemaRegistry } from "../../../models/schemaRegistry";
import { type KafkaTopic } from "../../../models/topic";
import { showErrorNotificationWithButtons } from "../../../notifications";
import { schemaSubjectQuickPick, schemaTypeQuickPick } from "../../../quickpicks/schemas";
import { getSidecar } from "../../../sidecar";
import { hashed, logUsage, UserEvent } from "../../../telemetry/events";
import { fileUriExists } from "../../../utils/file";
import { getSchemasViewProvider } from "../../../viewProviders/schemas";

const logger = new Logger("commands.utils.schemaManagement.upload");

/** Get the latest schema from a subject, possibly fetching from the schema registry if needed. */
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
 * Return a URI for a draft schema file that does not exist in the filesystem corresponding to a draft
 * next version of the given schema. The URI will have an untitled scheme and the schema data encoded
 * in the query string for future reference.
 **/
export async function determineDraftSchemaUri(schema: Schema): Promise<vscode.Uri> {
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

export async function uploadSchema(
  registry: SchemaRegistry,
  subject: string,
  schemaType: SchemaType,
  content: string,
) {
  const sidecar = await getSidecar();
  // Has the route for registering a schema under a subject.
  const schemaSubjectsApi = sidecar.getSubjectsV1Api(registry.id, registry.connectionId);
  // Can be used to look up subject + version pairs given a schema id.
  const schemasApi = sidecar.getSchemasV1Api(registry.id, registry.connectionId);

  // Learn the highest existing verion number of the schemas bound to this subject, if any.
  // (This way we can determine if we're creating a new subject or a binding new version of an existing schema.
  // (Alas, the return result from binding the schema to the subject doesn't include the binding's version number, so
  //  we have to look it up separately.)
  const existingVersion = await getHighestRegisteredVersion(schemaSubjectsApi, subject);

  logger.info(
    `Uploading schema to subject "${subject}" in registry "${registry.id}". Existing version: ${existingVersion}`,
  );

  /** ID given to the uploaded schema. May have been a preexisting id if this schema body had been registered previously. */
  let maybeNewId: number | undefined;

  let success: boolean;
  try {
    // todo ask if want to normalize schema? They ... probably do?
    const normalize = true;

    maybeNewId = await registerSchema(schemaSubjectsApi, subject, schemaType, content, normalize);

    success = true;

    logger.info(
      `Schema registered successfully as subject "${subject}" in registry "${registry.id}" as schema id ${maybeNewId}`,
    );
  } catch {
    success = false;
  }

  // Telemetry log the schema upload event + overall success or failure.
  logUsage(UserEvent.SchemaAction, {
    action: "upload",
    status: success ? "succeeded" : "failed",

    connection_id: registry.connectionId,
    connection_type: registry.connectionType,
    environment_id: registry.environmentId,

    schema_registry_id: registry.id,
    schema_type: schemaType,
    subject_hash: hashed(subject),
    schema_hash: hashed(content),
  });

  if (!success) {
    // Error message already shown by registerSchema()
    return;
  }

  let registeredVersion: number | undefined;
  try {
    // Try to read back the schema we just registered to get the version number bound to the subject we just bound it to.
    registeredVersion = await getNewlyRegisteredVersion(schemasApi, subject, maybeNewId!);
  } catch {
    // Error message already shown in getNewlyRegisteredVersion()
    return;
  }

  // Log + inform user of the successful schema registration, give them the option to view the schema in the schema registry.
  const successMessage = schemaRegistrationMessage(subject, existingVersion, registeredVersion);

  logger.info(successMessage);

  // Refresh the schema registry cache while offering the user the option to view
  // the schema in the Schemas view.
  const [viewchoice, newSchema]: [string | undefined, Schema] = await Promise.all([
    vscode.window.showInformationMessage(successMessage, "View in Schema Registry"),
    updateRegistryCacheAndFindNewSchema(registry, maybeNewId!, subject),
  ]);

  if (viewchoice) {
    // User chose to view the schema in the schema registry.

    // Unfurl the subject and highlight the new schema.
    // (Will reset the SR being viewed if necessary)
    await getSchemasViewProvider().revealSchema(newSchema);
  }
}

/** Does the given URI have any self-contained errors? If so, don't proceed with upload. */
export async function documentHasErrors(uri: vscode.Uri): Promise<boolean> {
  const diagnostics = vscode.languages.getDiagnostics(uri);
  const errorDiagnostics = diagnostics.filter(
    (d) => d.severity === vscode.DiagnosticSeverity.Error,
  );
  if (errorDiagnostics.length > 0) {
    void showErrorNotificationWithButtons(
      errorDiagnostics.length === 1
        ? "The schema document has an error."
        : "The schema document has errors.",
      {
        [errorDiagnostics.length === 1 ? "View Error" : "View Errors"]: async () =>
          // Focus the problems panel. We don't know of any way to further focus on
          // this specific file's errors, so just focus the whole panel.
          await vscode.commands.executeCommand("workbench.panel.markers.view.focus"),
      },
    );
    return true;
  }

  return false;
}

/**
 * Guide the user through chosing a subject to bind the schema to.
 */
export async function chooseSubject(registry: SchemaRegistry): Promise<string | undefined> {
  // Ask the user to choose a subject to bind the schema to. Shows subjects with schemas
  // using the given schema type. Will return "" if they want to create a new subject.
  let subject: string | undefined = await schemaSubjectQuickPick(registry);

  if (subject === "") {
    // User chose the 'create a new subject' quickpick item. Prompt for the new name.
    subject = await vscode.window.showInputBox({
      title: "Schema Subject",
      prompt: "Enter subject name",
      value: "newSubject-value",
      validateInput: validateNewSubject,
    });
  }

  return subject;
}

/** Validate the user's input for the new subject. */
export function validateNewSubject(
  userInput: string,
): vscode.InputBoxValidationMessage | undefined {
  if (!userInput.endsWith("-key") && !userInput.endsWith("-value")) {
    return {
      message: `Subjects not ending in "-key" or "-value" will not match the [TopicNameStrategy](https://docs.confluent.io/platform/current/schema-registry/fundamentals/serdes-develop/index.html#overview) and will not automatically associate with Kafka topics. (Press 'Enter' to confirm or 'Escape' to cancel)`,
      severity: vscode.InputBoxValidationSeverity.Warning,
    };
  }
}

/** Given the error message from a 409 conflict when trying to upload a new schema, extract
 * the human-readable message(s) from it. Return a semicolon delimited string.
 */
export function parseConflictMessage(schemaType: SchemaType, message: string): string {
  // Schema registry error reporting code and formatting varies per schema type.
  // And none of it is immediately machine-readable. So we have to
  // anti-string-sling the most meaningful bits out.

  const details = extractDetail(message);

  const regex = SCHEMA_TYPE_TO_CONFLICT_REGEX.get(schemaType);
  if (!regex) {
    logger.warn(`No conflict regex for schema type ${schemaType}`);
    return details;
  }

  const matchArray = Array.from(details.matchAll(regex));

  const humanMessages: string[] = [];

  if (matchArray.length > 0) {
    for (const match of matchArray) {
      // [0] is the whole match, [1] is the first capture group.
      humanMessages.push(match[1]);
    }
  } else {
    // Couldn't find any description blurbs, so just return the details.
    logger.warn(`No conflict messages found in details: ${details}`);
    humanMessages.push(details);
  }

  return humanMessages.join("; ");
}

/** Map schema type -> regex able to grok out the human readable message(s) within
 * conflict messages from the schema registry, namely when an attempted new version
 * of a schema is not backwards compatible with an existing version. Used by parseConflictMessage().
 */
const SCHEMA_TYPE_TO_CONFLICT_REGEX: Map<SchemaType, RegExp> = new Map([
  // Hey, sane start / end quotes!
  /*
  [{... description:"..."}, ...]
  */
  [SchemaType.Protobuf, /description:"(.*?)"},/g],

  // start and end with single quotes, but the description itself may contain single quotes, so be very
  // thorough in matching the end delimiter.
  [SchemaType.Avro, /description:'(.*?)', additionalInfo/g],

  // Thats right, you heard right, description starts with a double quote, but ends with a single quote, at least as
  // of time of writing.
  /*
  [{... description:"The new schema ...'}, ...]
  */
  [SchemaType.Json, /description:"(.*?)["']},/g],
]);

/**
 * Find the last occurrence of "details: " in the message, then return everything after it.
 */
export function extractDetail(message: string): string {
  const detailIndex = message.lastIndexOf("details: ");
  if (detailIndex === -1) {
    return message;
  }
  return message.slice(detailIndex + 9);
}

/** Return the success message to show the user after having uploaded a new schema */
export function schemaRegistrationMessage(
  subject: string,
  maxExistingVersion: number | undefined,
  newlyRegisteredVersion: number,
): string {
  if (maxExistingVersion === undefined) {
    return `Schema registered to new subject "${subject}"`;
  } else if (maxExistingVersion >= newlyRegisteredVersion) {
    // was normalized and matched an existing schema version for this subject
    return `Normalized to existing version ${newlyRegisteredVersion} for subject "${subject}"`;
  } else {
    // This was a new version of an existing subject. The newly registered version is higher than
    // the highest preexisting version.
    return `New version ${newlyRegisteredVersion} registered to existing subject "${subject}"`;
  }
}

/**
 * General map for associating Avro and Protobuf to their associated {@link SchemaType}s based on
 * either file extension or language ID.
 *
 * This does not include `json` because it may be used when editing an Avro schema without an Avro
 * language extension installed.
 */
export const AVRO_PROTOBUF_SCHEMA_TYPE_MAP = new Map([
  // language IDs
  ["avroavsc", SchemaType.Avro],
  ["proto", SchemaType.Protobuf],
  ["proto3", SchemaType.Protobuf],
  // file extensions
  ["avsc", SchemaType.Avro],
  ["proto", SchemaType.Protobuf],
]);

/**
 * Given a file/editor {@link vscode.Uri Uri}, determine the {@link SchemaType}.
 *
 * If a `languageId` is passed, it will be used if we can't determine a schema type from the Uri.
 * If we still can't determine the schema type, we'll show a quickpick to the user so they can choose.
 */
export async function determineSchemaType(
  uri: vscode.Uri,
  languageId?: string,
): Promise<SchemaType | undefined> {
  let schemaType: SchemaType | undefined;

  switch (uri.scheme) {
    case "file": {
      // extract the file extension from file.path
      const ext = uri.path.split(".").pop();
      if (ext) {
        schemaType = AVRO_PROTOBUF_SCHEMA_TYPE_MAP.get(ext);
      }
      break;
    }
    case "untitled": {
      // look up the editor belonging to the Uri
      const editor = vscode.window.visibleTextEditors.find(
        (e) => e.document.uri.toString() === uri.toString(),
      );
      if (editor) {
        // only match against Avro/Protobuf, if available
        schemaType = AVRO_PROTOBUF_SCHEMA_TYPE_MAP.get(editor.document.languageId);
      }
      break;
    }
  }

  if (languageId && !schemaType) {
    // fall back on any language ID, if provided
    schemaType = AVRO_PROTOBUF_SCHEMA_TYPE_MAP.get(languageId);
  }

  logger.debug("schemaType before quickpick", { schemaType });
  if (!schemaType) {
    // can't determine schema type from file/editor (or language ID, if passed), let the user pick
    return await schemaTypeQuickPick();
  }
  return schemaType;
}

/**
 * Given a subject, learn the highest existing version number of the schemas bound to this subject, if any.
 */
export async function getHighestRegisteredVersion(
  schemaSubjectsApi: SubjectsV1Api,
  subject: string,
): Promise<number | undefined> {
  // Learn the highest existing verion number of the schemas bound to this subject, if any. This way we can
  // tell if we're uploading a new schema or a new version of an existing schema.
  let existingVersion: number | undefined;
  try {
    // XXX Shoup: middlewares logging a long nasty if the schema is not found. Squelch?
    const existingVersions = await schemaSubjectsApi.listVersions({ subject: subject });
    if (existingVersions.length > 0) {
      // Ensure sorted
      existingVersions.sort((a, b) => a - b);
      // assign the last (highest version number) to existingVersion
      existingVersion = existingVersions[existingVersions.length - 1];
    }
  } catch (e) {
    if (e instanceof ResponseError) {
      const http_code = e.response.status;
      if (http_code === 404) {
        // This is fine, it means the subject doesn't exist yet.
        // Leave existingVersion as undefined.
      } else {
        // Some other error, so re-throw.
        throw e;
      }
    }
  }

  return existingVersion;
}

/** Drive the schema register route.
 * @returns The schema id of the newly registered schema. Will either be a new id or the id of an
 * existing schema that this one was normalized to. Alas that the schema registry doesn't return anything
 * other than the (new|existing) schema id.
 */
export async function registerSchema(
  schemaSubjectsApi: SubjectsV1Api,
  subject: string,
  schemaType: SchemaType,
  schemaContents: string,
  normalize: boolean,
): Promise<number> {
  const registerRequest: RegisterRequest = {
    subject: subject,
    RegisterSchemaRequest: {
      schemaType: schemaType,
      schema: schemaContents,
    },
    normalize: normalize,
  };

  try {
    // See ... terrible news at https://github.com/confluentinc/schema-registry/issues/173#issuecomment-362950435
    // (FROM DARK AGES 2018)
    // otherwise we get random 415 Unsupported Media Type errors when POSTing new schemas based on if the
    // request gets handled by 'follower node' and not the 'master' (sic) if the content type
    // isn't set to exactly application/json.
    const mainHeaders = schemaSubjectsApi["configuration"].headers!;
    const overrides = {
      headers: { ...mainHeaders, "Content-Type": "application/json" },
    };

    const response = await schemaSubjectsApi.register(registerRequest, overrides);
    return response.id!;
  } catch (e) {
    if (e instanceof ResponseError) {
      const http_code = e.response.status;
      const body = await e.response.json();

      let message: string | undefined;
      switch (http_code) {
        case 415:
          // The header override didn't do the trick!
          message = `Unsupported Media Type. Try again?`;
          break;
        case 409:
          // this schema conflicted with with prior version(s) of the schema
          // Extract out the juicy details from the error message (easier said than done due to
          // surprising inconsistencies).
          message = `Conflict with prior schema version: ${parseConflictMessage(schemaType, body.message)}`;
          break;
        case 422:
          if (body.error_code === 42201) {
            // the schema was invalid / bad syntax. Most of these will end with
            // "details: " followed by a more specific error message. Let's just show that
            // part.
            message = `Invalid schema: ${extractDetail(body.message)}`;
          }
          break;
      }

      if (!message) {
        message = `Error ${http_code} uploading schema: ${body.message}`;
      }

      logger.error(message);
      vscode.window.showErrorMessage(message);
    } else {
      // non-http-related error!
      // TODO log these in sentry
      logger.error("Error uploading schema", e);
      vscode.window.showErrorMessage(`Error uploading schema: ${e}`);
    }

    // rethrow to stop the overall schema upload process
    throw e;
  }
}

/**
 * Return the version number of the schema we just registered for the subject we
 * just bound it to.
 */
export async function getNewlyRegisteredVersion(
  schemasApi: SchemasV1Api,
  subject: string,
  schemaId: number,
): Promise<number> {
  // Try to read back the schema we just registered to get the version number bound to the subject we just bound it to.
  // (may take a few times / pauses if the request is served by a read replica that doesn't yet know about the schema we just registered, sigh.)
  for (let attempt = 0; attempt < 5; attempt++) {
    let subjectVersionPairs: SubjectVersion[] | undefined;
    try {
      subjectVersionPairs = await schemasApi.getVersions({ id: schemaId });
    } catch (e) {
      if (e instanceof ResponseError) {
        const http_code = e.response.status;
        if (http_code === 404) {
          // Pause a moment before trying again. We were just served by a read replica that
          // doesn't yet know about the schema id we just registered.
          await new Promise((resolve) => setTimeout(resolve, 100));
          continue;
        }
      }
    }

    for (const pair of subjectVersionPairs!) {
      if (pair.subject === subject) {
        // This is the version number used for the subject we just bound it to.
        return pair.version!;
      }
    }
    break;
  }

  // If we didn't get it in 5 tries, log and raise an error.
  const message = `Could not find subject "${subject}" in the list of bindings for schema id ${schemaId}`;
  logger.error(message);
  throw new Error(message);
}

/**
 * Drive the loader to update the schema registry cache and find and return the new Schema model.
 * @returns The new schema that was just registered, including the proper id, subject, etc. A TreeItem for this schema
 *         will have the same id as the corresponding TreeItem in the schema registry view.
 */
export async function updateRegistryCacheAndFindNewSchema(
  registry: SchemaRegistry,
  newSchemaID: number,
  boundSubject: string,
): Promise<Schema> {
  const loader = ResourceLoader.getInstance(registry.connectionId);

  logger.debug("updateRegistryCacheAndFindNewSchema: fetching new schemas for subject");
  // Deep fetch new schemas for this subject.
  const subjectSchemas = await loader.getSchemasForSubject(registry, boundSubject, true);

  // Find the schema in the list of schemas for this registry. We know that
  // it should be present in the cache because we have just refreshed the cache (if any).
  const schema = subjectSchemas.find((s) => s.id === `${newSchemaID}`);

  if (!schema) {
    throw new Error(`Could not find schema with id ${newSchemaID} in registry ${registry.id}`);
  }

  const updatedSubject = schema.subjectWithSchemasObject(subjectSchemas);

  // Was a new subject being created?
  if (subjectSchemas.length === 1) {
    // Purge the cache of subjects for this registry, 'cause new one now exists. Would be better if the
    // schema creation were done via the loader, so that it could have handled this
    // need internally like is done when deleting a schema.
    await loader.clearCache(registry);

    // Announce creation of new subject + known single contained schema version.
    logger.debug("updateRegistryCacheAndFindNewSchema:: announcing new subject");
    schemaSubjectChanged.fire({ change: "added", subject: updatedSubject });
  } else {
    logger.debug(
      "updateRegistryCacheAndFindNewSchema:: announcing new schema version within existing subject",
    );
    // New schema version for an existing subject. Provide the new schema[].
    schemaVersionsChanged.fire({ change: "added", subject: updatedSubject });
  }

  return schema;
}

/**
 * Construct a Schema object from JSON string.
 * @returns Schema or undefined if was unable to complete.
 */
export function schemaFromString(source: string): Schema | undefined {
  const query = decodeURIComponent(source);
  let schemaFromJSON: Schema | undefined;

  try {
    schemaFromJSON = JSON.parse(query);
  } catch (e) {
    // Must not have been a valid JSON object.
    logger.error("Could not parse JSON from URI query string", e);
    return undefined;
  }

  if (!schemaFromJSON) {
    logger.warn("Could not parse schema object from URI query string", { query });
  } else {
    logger.info("Was able to parse object from URI query string", {
      schemaFromJSON: schemaFromJSON,
    });
    try {
      return Schema.create(schemaFromJSON);
    } catch (e) {
      // Must not have been a valid schema object.
      logger.error("Could not create schema object from parsed JSON", e);
    }
    return undefined;
  }
}
