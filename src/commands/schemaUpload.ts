import * as vscode from "vscode";
import {
  RegisterRequest,
  ResponseError,
  SubjectsV1Api,
  SubjectVersion,
} from "../clients/schemaRegistryRest";
import { currentSchemaRegistryChanged } from "../emitters";
import { Logger } from "../logging";
import { SchemaType } from "../models/schema";
import { schemaRegistryQuickPick } from "../quickpicks/schemaRegistries";
import { schemaSubjectQuickPick } from "../quickpicks/schemas";
import { getSidecar } from "../sidecar";
import { CCloudResourcePreloader } from "../storage/ccloudPreloader";
import { getResourceManager } from "../storage/resourceManager";
import { getSchemasViewProvider } from "../viewProviders/schemas";

const logger = new Logger("commands.schemaUpload");

/** Module for the "upload schema to schema registry" command (""confluent.schemas.upload") and related functions */

/* TODO

  * Change package registration to "resourceExtname in CONFLUENT_SCHEMA_FILE_EXTENSIONS" (look in extension.ts for other examples -- setup context values())
    -- would then pivot off of the language type, not the file extension, https://code.visualstudio.com/api/references/when-clause-contexts
*/

/**
 * Command backing "Upload a new schema".
 */
export async function uploadNewSchema(item: vscode.Uri) {
  // Get the contents of the active editor
  let activeEditor = vscode.window.activeTextEditor;
  if (!activeEditor) {
    vscode.window.showErrorMessage("Must be invoked from an active editor");
    return;
  }
  const schemaContents = activeEditor.document.getText();

  if (!item) {
    vscode.window.showErrorMessage("Must be invoked with an Avro, JSON Schema, or Protobuf file");
    return;
  }

  // What kind of schema is this? We must tell the schema registry.
  let schemaType: SchemaType;
  try {
    schemaType = determineSchemaType(item, activeEditor.document.languageId);
  } catch (e) {
    vscode.window.showErrorMessage((e as Error).message);
    return;
  }

  // If the document has errors, don't proceed with upload.
  if (await documentHadErrors(activeEditor)) {
    logger.error("Document has errors, aborting schema upload");
    return;
  }

  // Ask the user to choose a schema registry to upload to.
  const registry = await schemaRegistryQuickPick();
  if (!registry) {
    logger.info("No registry chosen, aborting schema upload");
    return;
  }

  // Ask the user to choose a subject to bind the schema to.
  const subject = await chooseSubject(registry.id, schemaType);
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

  // todo ask if want to normalize schema? They ... probably do?
  const normalize = true;
  const uploadRequest: RegisterRequest = {
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
    // request gets handled by 'follower node' and not the 'master' (sic).
    const mainHeaders = schemaSubjectsApi["configuration"].headers!;
    const overrides = {
      headers: { ...mainHeaders, "Content-Type": "application/json" },
    };

    const response = await schemaSubjectsApi.register(uploadRequest, overrides);
    const maybeNewId = response.id!;

    logger.info(
      `Schema registered successfully as subject "${subject}" in registry "${registry.id}" as schema id ${maybeNewId}`,
    );

    // TODO: push this into a helper function getRegisteredVersion(subject, schemaId): number

    // Try to read back the schema we just registered to get the version number bound to the subject we just bound it to.
    // (may take a few times / pauses if the request is served by a read replica that doesn't yet know about the schema we just registered, sigh.)
    let registeredVersion: number | undefined;

    for (let attempt = 0; attempt < 5; attempt++) {
      let subjectVersionPairs: SubjectVersion[] | undefined;
      try {
        subjectVersionPairs = await schemasApi.getVersions({ id: maybeNewId });
      } catch (e) {
        if (e instanceof ResponseError) {
          const http_code = e.response.status;
          if (http_code === 404) {
            // Pause a moment before trying again. We were just served by a read replica that
            // doesn't yet know about the schema we just registered.
            await new Promise((resolve) => setTimeout(resolve, 100));
            continue;
          }
        }
      }
      logger.info("subjectVersionPairs", subjectVersionPairs);

      for (const pair of subjectVersionPairs!) {
        if (pair.subject === subject) {
          // This is the version number used for the subject we just bound it to.
          registeredVersion = pair.version;
          break;
        }
      }
      break;
    }

    if (registeredVersion === undefined) {
      // Could not find the subject in the list of versions?!
      logger.error(
        `Could not find subject "${subject}" in the list of versions for schema id ${maybeNewId}`,
      );
    }

    // Log + inform user of the result.
    const message = schemaRegistrationMessage(subject, existingVersion, registeredVersion!);

    logger.info(message);
    const viewChoice = await vscode.window.showInformationMessage(
      message,
      "View in Schema Registry",
    );
    if (viewChoice) {
      // get the schemas view controller to refresh and show the new schema
      // (change this to directly using the preloader so we know exactly when it completes)
      const preloader = CCloudResourcePreloader.getInstance();
      // Force a refresh of the schemas for this registry, since we just added a new schema.
      await preloader.ensureSchemasLoaded(registry.id, true);

      // Get the schemas view provider to refresh the view on the right registry.
      currentSchemaRegistryChanged.fire(registry);

      // Find the schema in the list of schemas for this registry.
      const allSchemas = await getResourceManager().getSchemasForRegistry(registry.id);
      const schema = allSchemas!.find((s) => s.id === `${maybeNewId}` && s.subject === subject);

      // get the new schema to show in the view by getting the treeitem to reveal
      // the schema's item.
      const schemaViewProvider = getSchemasViewProvider();
      schemaViewProvider.revealSchema(schema!);
    }
    // Refresh that schema registry in view controller if needed, otherwise at least
    getSchemasViewProvider().refreshIfShowingRegistry(registry.id);
  } catch (e) {
    if (e instanceof ResponseError) {
      const http_code = e.response.status;
      const body = await e.response.json();

      let message: string | null = null;
      switch (http_code) {
        case 415:
          // The header override didn't do the trick!
          message = `Alas, Unsupported Media Type. Try again?`;
          break;
        case 409:
          // this schema conflicted with with prior version(s) of the schema
          message = `Conflict with prior schema version(s): ${body.message}`;
          break;
        case 422:
          if (body.error_code === 42201) {
            // the schema was invalid / bad syntax. Most of these will end with
            // "details: " followed by a more specific error message. Let's just show that
            // part.
            message = `Invalid schema: ${extractDetail(body.message)}`;
            logger.error(message);
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
  }
}

/**
 * Does the document have any self-contained errors? If so, don't proceed with upload.
 */
async function documentHadErrors(activeEditor: vscode.TextEditor): Promise<boolean> {
  const diagnostics = vscode.languages.getDiagnostics(activeEditor.document.uri);
  const errorDiagnostics = diagnostics.filter(
    (d) => d.severity === vscode.DiagnosticSeverity.Error,
  );
  if (errorDiagnostics.length > 0) {
    const doView = await vscode.window.showErrorMessage(
      errorDiagnostics.length === 1
        ? "The schema document has an error."
        : "The schema document has errors.",
      "View Errors",
    );

    // they picked one of the errors, so jump to it.
    if (doView) {
      // execute command workbench.panel.markers.view.focus
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
  registryId: string,
  schemaType: SchemaType,
): Promise<string | undefined> {
  // Ask the user to choose a subject to bind the schema to. Shows subjects with schemas
  // using the given schema type. Will return "" if they want to create a new subject.
  let subject = await schemaSubjectQuickPick(registryId, schemaType);

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
/**
 * Find the last occurrence of "details: " in the message, then return everything after it.
 */
function extractDetail(message: string): string {
  const detailIndex = message.lastIndexOf("details: ");
  if (detailIndex === -1) {
    return message;
  }
  return message.slice(detailIndex + 9);
}

/** Return the success message to show the user after having uploaded a new schema */
function schemaRegistrationMessage(
  subject: string,
  existingVersion: number | undefined,
  registeredVersion: number,
): string {
  // todo: make this return markdown and to not induce pain for the reader. Use a header
  // that clearly delineates the different cases, then key / value rows for the details.

  if (existingVersion === undefined) {
    return `Schema registered to new subject subject "${subject}"`;
  } else if (existingVersion === registeredVersion) {
    // was normalized and matched an existing schema version for this subject
    return `Normalized to existing version ${registeredVersion} for subject "${subject}"`;
  } else {
    // This was a new version of an existing subject.
    return `New version ${registeredVersion} registered to existing subject "${subject}"`;
  }
}

export function determineSchemaType(
  file: vscode.Uri | null,
  languageId: string | null,
): SchemaType {
  if (!file && !languageId) {
    throw new Error("Must call with either a file or document");
  }

  let schemaType: SchemaType | unknown = null;

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

async function getHighestRegisteredVersion(
  schemaSubjectsApi: SubjectsV1Api,
  subject: string,
): Promise<number | undefined> {
  // Learn the highest existing verion number of the schemas bound to this subject, if any. This way we can
  // tell if we're uploading a new schema or a new version of an existing schema.
  let existingVersion: number | undefined;
  try {
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
