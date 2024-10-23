import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import { RegisterRequest, ResponseError } from "../clients/schemaRegistryRest";
import { SchemaDocumentProvider } from "../documentProviders/schema";
import { Logger } from "../logging";
import { ContainerTreeItem } from "../models/main";
import { Schema } from "../models/schema";
import { SchemaRegistry } from "../models/schemaRegistry";
import { KafkaTopic } from "../models/topic";
import { schemaRegistryQuickPick } from "../quickpicks/schemaRegistries";
import { getSidecar } from "../sidecar";
import { ResourceManager } from "../storage/resourceManager";
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
    for (const d of diagnostics.slice(0, 3)) {
      const message = `${d.message} (${d.range.start.line}:${d.range.start.character} - ${d.range.end.line}:${d.range.end.character})`;
      // Preserves the order of the messages from the diagnostics from the document.
      this.messages.push(message);
      // Will be hash-ordered.
      this.messageToError.set(message, d);
    }
  }

  public getMessages(): string[] {
    return this.messages;
  }

  /** Given the choice made by the user, return the Diagnostic */
  public findErrorByString(errorString: string): vscode.Diagnostic | undefined {
    return this.messageToError.get(errorString);
  }
}

/* TODO

  * Change package registration to "resourceExtname in CONFLUENT_SCHEMA_FILE_EXTENSIONS" (look in extension.ts for other examples -- setup context values())
    -- would then pivot off of the language type, not the file extension, https://code.visualstudio.com/api/references/when-clause-contexts


/** Upload a new schema / version (or perhaps a new subject binding to an existing schema) to a schema registry */
export async function uploadNewSchema(item: vscode.Uri) {
  logger.info(`Invoked uploadNewSchema: ${item}`);

  let activeEditor = vscode.window.activeTextEditor;
  if (!activeEditor) {
    return;
  }
  const schemaContents = activeEditor.document.getText();

  if (!item) {
    vscode.window.showErrorMessage("Must be invoked with an Avro, JSON, or Protobuf file");
    return;
  }

  // What kind of shema is this?
  let schemaType: string;
  try {
    schemaType = determineSchemaType(item, activeEditor.document);
    logger.info(`Detected schema type: ${schemaType}`);
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
    const errorSerde = new DocumentErrorRangeSerde(errorDiagnostics);

    logger.error("Not going to upload schema since there are errors in the document");
    const choice = await vscode.window.showErrorMessage(
      `Errors are being reported in the ${schemaType} document. Please fix and try again.`,
      ...errorSerde.getMessages(),
    );

    // they picked one of the errors, so jump to it.
    if (choice) {
      const error = errorSerde.findErrorByString(choice);
      if (error) {
        const range = error.range;
        activeEditor.revealRange(range);
        activeEditor.selection = new vscode.Selection(range.start, range.end);
      }
    }
    return;
  }

  logger.info("No errors in the document, proceeding with schema upload");

  // todo quickpick to select schema registry, default to the one in the view
  const registry = await schemaRegistryQuickPick();
  if (!registry) {
    logger.info("No schema registry selected, aborting schema upload");
    return;
  }

  logger.info(`Selected schema registry: ${registry.id}`);

  // todo quickpick to select subject, default to one selected in view (if any)
  const subject = await vscode.window.showInputBox({
    title: "Schema Subject",
    prompt: "Enter subject name",
  });

  if (!subject) {
    logger.info("No subject chosen, aborting schema upload");
    return;
  }

  // todo ask if want to normalize schema
  const normalize = false;

  // ask preloader to have loaded schemas for this registry ... .
  // see if subject binding exists already

  const sidecar = await getSidecar();

  const schemaApi = sidecar.getSubjectsV1Api(registry.id, registry.connectionId);

  const uploadRequest: RegisterRequest = {
    subject: subject,
    RegisterSchemaRequest: {
      schemaType: schemaType,
      schema: schemaContents,
    },
    normalize: normalize,
  };

  // See ... terrible news at https://github.com/confluentinc/schema-registry/issues/173#issuecomment-362950435
  // (FROM DARK AGES 2018)
  // otherwise we get random 415 Unsupported Media Type errors when POSTing new schemas based on if the
  // request gets handled by 'follower node' and not the 'master' (sic).

  //
  const mainHeaders = schemaApi["configuration"].headers!;

  const overrides = {
    headers: { ...mainHeaders, "Content-Type": "application/json" },
  };

  try {
    const response = await schemaApi.register(uploadRequest, overrides);
    const maybeNewId = response.id;

    // Log + inform user of the result.
    // TODO: Improve this: Was this a new version being registered of existing subject, or a new subject?
    const message = `Schema registered successfully as subject "${subject}" in registry "${registry.id}" as schema id ${maybeNewId}`;

    logger.info(message);
    vscode.window.showInformationMessage(message);
    // Refresh that schema registry in view controller if needed, otherwise at least
    getSchemasViewProvider().refreshIfShowingRegistry(registry.id);

    // purge prior cached results.
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
            // the schema was invalid / bad syntax
            message = `Invalid schema: ${body.message}`;
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

export function determineSchemaType(
  file: vscode.Uri | null,
  document: vscode.TextDocument | null,
): string {
  if (!file && !document) {
    throw new Error("Must call with at least either a file or document");
  }

  let schemaType: string | unknown = null;

  if (document) {
    const languageIdToSchemaType = new Map([
      ["avroavsc", "AVRO"],
      ["proto", "PROTOBUF"],
      ["json", "JSON"],
    ]);
    schemaType = languageIdToSchemaType.get(document.languageId);
  }

  if (!schemaType && file) {
    // extract the file extension from file.path
    const ext = file.path.split(".").pop();
    if (ext) {
      const extensionToSchemaType = new Map([
        ["avsc", "AVRO"],
        ["proto", "PROTOBUF"],
        ["json", "JSON"],
      ]);
      schemaType = extensionToSchemaType.get(ext);
    }
  }

  if (!schemaType) {
    throw new Error("Could not determine schema type from file or document");
  }

  return schemaType as string;
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
