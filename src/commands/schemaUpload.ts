import * as vscode from "vscode";
import {
  RegisterRequest,
  ResponseError,
  SchemasV1Api,
  SubjectsV1Api,
  SubjectVersion,
} from "../clients/schemaRegistryRest";
import { currentSchemaRegistryChanged } from "../emitters";
import { Logger } from "../logging";
import { Schema, SchemaType } from "../models/schema";
import { SchemaRegistry } from "../models/schemaRegistry";
import { schemaRegistryQuickPick } from "../quickpicks/schemaRegistries";
import { schemaSubjectQuickPick } from "../quickpicks/schemas";
import { getSidecar } from "../sidecar";
import { ResourceLoader } from "../storage/resourceLoader";
import { getSchemasViewProvider, SchemasViewProvider } from "../viewProviders/schemas";

const logger = new Logger("commands.schemaUpload");

/** Module for the "upload schema to schema registry" command (""confluent.schemas.upload") and related functions.
 *
 * uploadNewSchema() command is registered over in ./schemas.ts, but the actual implementation is here.
 * All other exported functions are exported for the tests in schemaUpload.test.ts.
 */

/**
 * Command backing "Upload a new schema".
 */
export async function uploadNewSchema(fileUri: vscode.Uri) {
  if (!fileUri) {
    vscode.window.showErrorMessage("Must be invoked with an Avro, JSON Schema, or Protobuf file");
    return;
  }

  // Get the contents of the active editor. Will be the schema payload to upload.
  let activeEditor = vscode.window.activeTextEditor;
  if (!activeEditor) {
    vscode.window.showErrorMessage("Must be invoked from an active editor");
    return;
  }
  const schemaContents = activeEditor.document.getText();

  // If there's a query string in the URL, it should be the encoding of a Schema
  // object. Parse it into a Schema object if possible to use it for default
  // values
  let defaults: Schema | undefined;

  if (fileUri.query) {
    const query = decodeURIComponent(fileUri.query);
    const schemaFromJSON = JSON.parse(query);
    if (!schemaFromJSON) {
      logger.warn("Could not parse schema object from URI query string", { query });
    } else {
      logger.info("Was able to parse object from URI query string", {
        schemaFromJSON: schemaFromJSON,
      });
      try {
        defaults = Schema.create(schemaFromJSON);
      } catch (e) {
        // Must not have been a valid schema object.
        logger.error("Could not create schema object from parsed JSON", e);
      }
    }
  }

  // What kind of schema is this? We must tell the schema registry.
  let schemaType: SchemaType;
  try {
    schemaType = determineSchemaType(fileUri, activeEditor.document.languageId, defaults?.type);
  } catch (e) {
    vscode.window.showErrorMessage((e as Error).message);
    return;
  }
  // XXX todo show quickpick to choose schema type, value defaulting to the currently determined type.

  // If the document has (locally marked) errors, don't proceed with upload.
  if (await documentHasErrors(activeEditor)) {
    logger.error("Document has errors, aborting schema upload");
    return;
  }

  // Ask the user to choose a schema registry to upload to.
  const registry = await schemaRegistryQuickPick(defaults?.schemaRegistryId);
  if (!registry) {
    logger.info("No registry chosen, aborting schema upload");
    return;
  }

  // Ask the user to choose a subject to bind the schema to.
  const subject = await chooseSubject(registry, schemaType);
  if (!subject) {
    logger.info("No subject chosen, aborting schema upload");
    vscode.window.showInformationMessage("Schema upload aborted.");
    return;
  }

  // OK, all the user input is in. Let's upload the schema.
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

  try {
    // todo ask if want to normalize schema? They ... probably do?
    const normalize = true;

    maybeNewId = await registerSchema(
      schemaSubjectsApi,
      subject,
      schemaType,
      schemaContents,
      normalize,
    );

    logger.info(
      `Schema registered successfully as subject "${subject}" in registry "${registry.id}" as schema id ${maybeNewId}`,
    );
  } catch {
    // Error message already shown in registerSchema()
    return;
  }

  let registeredVersion: number | undefined;
  try {
    // Try to read back the schema we just registered to get the version number bound to the subject we just bound it to.
    registeredVersion = await getNewlyRegisteredVersion(schemasApi, subject, maybeNewId);
  } catch {
    // Error message already shown in getNewlyRegisteredVersion()
    return;
  }

  // Log + inform user of the successful schema registration, give them the option to view the schema in the schema registry.
  const successMessage = schemaRegistrationMessage(subject, existingVersion, registeredVersion!);

  logger.info(successMessage);

  const schemaViewProvider = getSchemasViewProvider();

  // Refresh the schema registry cache while offering the user the option to view the schema in the schema registry.
  const results: [string | undefined, Schema] = await Promise.all([
    vscode.window.showInformationMessage(successMessage, "View in Schema Registry"),
    updateRegistryCacheAndFindNewSchema(registry, maybeNewId, subject, schemaViewProvider),
  ]);

  if (results[0]) {
    // User chose to view the schema in the schema registry.

    // Get the schemas view provider to refresh the view on the right registry.
    // (The resource manager data for that registry will be updated with the new schema
    //  via updateRegistryCacheAndFindNewSchema() which has already resolved.)
    currentSchemaRegistryChanged.fire(registry);

    // get the new schema to pop in the view by getting the treeitem to reveal
    // the schema's item.
    schemaViewProvider.revealSchema(results[1]);
  }
}

/**
 * Does the document have any self-contained errors? If so, don't proceed with upload.
 */
async function documentHasErrors(activeEditor: vscode.TextEditor): Promise<boolean> {
  const diagnostics = vscode.languages.getDiagnostics(activeEditor.document.uri);
  const errorDiagnostics = diagnostics.filter(
    (d) => d.severity === vscode.DiagnosticSeverity.Error,
  );
  if (errorDiagnostics.length > 0) {
    const doView = await vscode.window.showErrorMessage(
      errorDiagnostics.length === 1
        ? "The schema document has an error."
        : "The schema document has errors.",
      errorDiagnostics.length === 1 ? "View Error" : "View Errors",
    );

    if (doView) {
      // Focus the problems panel. We don't know of any way to further focus on
      // this specific file's errors, so just focus the whole panel.
      vscode.commands.executeCommand("workbench.panel.markers.view.focus");
    }
    return true;
  }

  return false;
}

/**
 * Guide the user through chosing a subject to bind the schema to.
 */
async function chooseSubject(
  registry: SchemaRegistry,
  schemaType: SchemaType,
): Promise<string | undefined> {
  // Ask the user to choose a subject to bind the schema to. Shows subjects with schemas
  // using the given schema type. Will return "" if they want to create a new subject.
  let subject = await schemaSubjectQuickPick(registry, schemaType);

  if (subject === "") {
    // User chose the 'create a new subject' quickpick item. Prompt for the new name.
    subject = await vscode.window.showInputBox({
      title: "Schema Subject",
      prompt: "Enter subject name",
      value: "newSubject-value",
    });

    // Warn if subject doesn't match TopicNamingStrategy, but allow if they really want.
    if (subject && !subject.endsWith("-key") && !subject.endsWith("-value")) {
      const choice = await vscode.window.showInputBox({
        title: "Subject Name Warning",
        prompt: `Subject name "${subject}" does not end with "-key" or "-value". Continue ("yes", "no", or enter new subject name ending with either "-key" or "-value")?`,
      });

      if (choice) {
        if (choice.endsWith("-key") || choice.endsWith("-value")) {
          subject = choice;
        } else if (choice.toLowerCase() === "yes") {
          // they confirmed they want to continue with the subject as is.
          // Fallthrough with subject as is.
        } else {
          // "no"-ish response, so abort.
          subject = undefined;
        }
      } else {
        // escape aborted from the input box
        subject = undefined;
      }
    }
  }

  return subject;
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
 * Given a file and / or a language id, determine the schema type of the file.
 */
export function determineSchemaType(
  file: vscode.Uri | null,
  languageId: string | null,
  defaultType: SchemaType | undefined = undefined,
): SchemaType {
  if (!file && !languageId) {
    throw new Error("Must call with either a file or document");
  }

  let schemaType: SchemaType | unknown = defaultType;

  // If the schema type was provided in the defaults, use that.
  if (schemaType) {
    return schemaType as SchemaType;
  }

  if (languageId) {
    const languageIdToSchemaType = new Map([
      ["avroavsc", SchemaType.Avro],
      ["proto", SchemaType.Protobuf],
      ["json", SchemaType.Json],
    ]);
    schemaType = languageIdToSchemaType.get(languageId);
  }

  if (!schemaType && file) {
    // extract the file extension from file.path
    const ext = file.path.split(".").pop();
    if (ext) {
      const extensionToSchemaType = new Map([
        ["avsc", SchemaType.Avro],
        ["proto", SchemaType.Protobuf],
        ["json", SchemaType.Json],
      ]);
      schemaType = extensionToSchemaType.get(ext);
    }
  }

  if (!schemaType) {
    throw new Error("Could not determine schema type from file or document");
  }

  return schemaType as SchemaType;
}

/**
 * Given a subject, learn the highest existing version number of the schemas bound to this subject, if any.
 */
async function getHighestRegisteredVersion(
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
async function registerSchema(
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
async function getNewlyRegisteredVersion(
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
async function updateRegistryCacheAndFindNewSchema(
  registry: SchemaRegistry,
  newSchemaID: number,
  boundSubject: string,
  schemaViewProvider: SchemasViewProvider,
): Promise<Schema> {
  const loader = ResourceLoader.getInstance(registry.connectionId);

  const allSchemas = await loader.getSchemasForRegistry(registry, true);

  // Find the schema in the list of schemas for this registry. We know that
  // it should be present in the cache because we have just refreshed the cache.
  const schema = allSchemas!.find((s) => s.id === `${newSchemaID}` && s.subject === boundSubject);

  // While here, if the schema view controller is focused on this registry, do a shallow refresh
  //  (shallow is fine because we just updated any possible cache at the loader level).

  // This ensures that even if the user doesn't chose to highlight the new schema in the schema registry view,
  // they will still see the new schema in the view if they currently have its schema registry open
  // w/o having to hit the 'refresh' button.

  if (schemaViewProvider.schemaRegistry?.id === registry.id) {
    schemaViewProvider.refresh();
  }

  return schema!;
}
