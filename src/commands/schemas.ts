import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import { RegisterRequest, ResponseError, SubjectVersion } from "../clients/schemaRegistryRest";
import { SchemaDocumentProvider } from "../documentProviders/schema";
import { currentSchemaRegistryChanged } from "../emitters";
import { Logger } from "../logging";
import { ContainerTreeItem } from "../models/main";
import { Schema, SchemaType } from "../models/schema";
import { SchemaRegistry } from "../models/schemaRegistry";
import { KafkaTopic } from "../models/topic";
import { schemaRegistryQuickPick } from "../quickpicks/schemaRegistries";
import { schemaSubjectQuickPick } from "../quickpicks/schemas";
import { getSidecar } from "../sidecar";
import { CCloudResourcePreloader } from "../storage/ccloudPreloader";
import { getResourceManager, ResourceManager } from "../storage/resourceManager";
import { getSchemasViewProvider } from "../viewProviders/schemas";

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

/**
 * Class to serialize an array of vscode.Diagnostic objects to strings for display in error message buttons,
 * then to return the selected Diagnostic object given the string chosen by the user (if any).
 */
export class DocumentErrorRangeSerde {
  readonly messages: string[] = [];
  readonly messageToError: Map<string, vscode.Diagnostic> = new Map();

  public constructor(diagnostics: vscode.Diagnostic[]) {
    // Only retain the first three errors. Convert each to a string for display in the error message buttons.

    // First see if the error messages are unique or not. Those not unique will be appended with their line number.
    const messageToCount = new Map<string, number>();
    for (const d of diagnostics) {
      const message = d.message;
      const count = messageToCount.get(message) || 0;
      messageToCount.set(message, count + 1);
    }

    function getDisplayMessage(d: vscode.Diagnostic): string {
      // If the message is not unique (seen more than once), append the line number to the message.
      const count = messageToCount.get(d.message) || 0;
      return count > 1 ? `${d.message} (line ${d.range.start.line + 1})` : d.message;
    }

    for (const d of diagnostics.slice(0, 3)) {
      const message = getDisplayMessage(d);
      // Preserves the order of the messages from the diagnostics from the document.
      this.messages.push(message);
      // Will be hash-ordered.
      this.messageToError.set(message, d);
    }
  }

  /** Return the error messages to display to the user */
  public getMessages(): string[] {
    return this.messages;
  }

  /** Given the choice made by the user, return the corresponding error Diagnostic */
  public findErrorByString(errorString: string): vscode.Diagnostic | undefined {
    return this.messageToError.get(errorString);
  }
}

/* TODO

  * Change package registration to "resourceExtname in CONFLUENT_SCHEMA_FILE_EXTENSIONS" (look in extension.ts for other examples -- setup context values())
    -- would then pivot off of the language type, not the file extension, https://code.visualstudio.com/api/references/when-clause-contexts


/** Upload a new schema / version (or perhaps a new subject binding to an existing schema) to a schema registry */
export async function uploadNewSchema(item: vscode.Uri) {
  // First determine the kind of schema we're dealing with given the file URI and its contents.

  // (We like the active editor because easy to get at both the file contents as well as the languageId.)
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

  // Does the document have any self-contained errors? If so, don't proceed with upload.
  const diagnostics = vscode.languages.getDiagnostics(activeEditor.document.uri);
  const errorDiagnostics = diagnostics.filter(
    (d) => d.severity === vscode.DiagnosticSeverity.Error,
  );
  if (errorDiagnostics.length > 0) {
    logger.error("Not going to upload schema since there are errors in the document");
    const doView = await vscode.window.showErrorMessage(
      `The schema document has errors.`,
      "View Errors",
    );

    // they picked one of the errors, so jump to it.
    if (doView) {
      // execute command workbench.panel.markers.view.focus
      vscode.commands.executeCommand("workbench.panel.markers.view.focus");
    }
    return;
  }

  const registry = await schemaRegistryQuickPick();
  if (!registry) {
    logger.info("No registry chosen, aborting schema upload");
    vscode.window.showInformationMessage("Schema upload aborted.");
    return;
  }

  let subject = await schemaSubjectQuickPick(registry.id, schemaType);

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
          // they confirmed they want to continue with the subject as is
        } else {
          // aborted, indicate abort path.
          subject = undefined;
        }
      } else {
        // escape aborted
        subject = undefined;
      }
    }
  }

  if (!subject) {
    logger.info("No subject chosen, aborting schema upload");
    vscode.window.showInformationMessage("Schema upload aborted.");
    return;
  }

  const sidecar = await getSidecar();
  // Has the route for registering a schema under a subject.
  const schemaSubjectsApi = sidecar.getSubjectsV1Api(registry.id, registry.connectionId);
  // Can be used to look up subject + version pairs given a schema id.
  const schemasApi = sidecar.getSchemasV1Api(registry.id, registry.connectionId);

  // Learn the highest existing verion number of the schemas bound to this subject, if any. This way we can
  // tell if we're uploading a new schema or a new version of an existing schema.
  let existingVersion: number | null = null;
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
        // Leave existingVersion as null.
      } else {
        // Some other error, so re-throw.
        throw e;
      }
    }
  }

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
    // (may take a few times / pauses)
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
    // TODO: Improve this: Was this a new version being registered of existing subject, or a new subject?
    const message = schemaRegistrationMessage(
      schemaType,
      subject,
      registry.id,
      maybeNewId,
      existingVersion,
      registeredVersion!,
    );

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
  schemaType: string,
  subject: string,
  registry_id: string,
  schemaId: number,
  existingVersion: number | null,
  registeredVersion: number,
): string {
  // todo: make this return markdown and to not induce pain for the reader. Use a header
  // that clearly delineates the different cases, then key / value rows for the details.

  // todo: then write tests.
  if (existingVersion === null) {
    return `Schema registered to new subject subject "${subject}" in registry "${registry_id}" as schema id ${schemaId}, version ${registeredVersion}, type ${schemaType}`;
  } else if (existingVersion === registeredVersion) {
    // was normalized and matched an existing schema version for this subject
    return `Normalized to existing ${schemaType} schema version ${registeredVersion} for subject "${subject}" in registry "${registry_id}, id ${schemaId}`;
  } else {
    // This was a new version of an existing subject.
    return `New ${schemaType} schema version registered to existing subject "${subject}" in registry "${registry_id}" as schema id ${schemaId}, version ${registeredVersion}`;
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
    registerCommandWithLogging("confluent.schemas.upload", uploadNewSchema),
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
 * Get the highest versioned schema(s) related to a single topic from the schema registry.
 * May return two schemas if the topic has both key and value schemas.
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
