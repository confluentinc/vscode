import * as vscode from "vscode";
import { ResourceDocumentProvider } from ".";
import { SchemaString, SchemasV1Api } from "../clients/schemaRegistryRest";
import { Logger } from "../logging";
import { getLanguageTypes, Schema, type SchemaType } from "../models/schema";
import { getSidecar } from "../sidecar";

export const SCHEMA_URI_SCHEME = "confluent.schema";

const logger = new Logger("documentProviders.schema");

/** Makes a read-only editor buffer holding a schema */
export class SchemaDocumentProvider extends ResourceDocumentProvider {
  // non-file, non-untitled URIs cause the resulting buffer to be read-only
  scheme = SCHEMA_URI_SCHEME;

  public async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    // parse the query string into the JSON respresentation of the original schema object
    const schemaObj: Schema = this.parseUriQueryBody(uri.query) as Schema;

    // Promote from as-from-json to a full Schema object
    const schema = Schema.create(schemaObj);

    // Get the prettified schema definition
    return fetchSchemaBody(schema);
  }
}

/**
 * Fetch the document body of a schema.
 * @param schema The schema to fetch
 * @param prettified Whether to prettify the schema definition before displaying, default=true
 * */
export async function fetchSchemaBody(schema: Schema, prettified: boolean = true): Promise<string> {
  // fetch the schema definition from the sidecar and attempt to prettify it before displaying
  const client: SchemasV1Api = (await getSidecar()).getSchemasV1Api(
    schema.schemaRegistryId,
    schema.connectionId,
  );
  const schemaResp: SchemaString = await client.getSchema({ id: Number(schema.id) });
  const schemaDefinition = prettified ? prettifySchemaDefinition(schemaResp) : schemaResp.schema;
  if (!schemaDefinition) {
    throw new Error("Failed to load schema definition; it may be empty or invalid.");
  }
  return schemaDefinition;
}

/**
 * Attempt to prettify a schema definition for display in a read-only editor tab.
 * @param schemaResp The schema response object from the Schema Registry REST API
 * @returns The prettified schema definition, or undefined if the schema content is empty or invalid
 */
function prettifySchemaDefinition(schemaResp: SchemaString): string | undefined {
  let schemaDefinition = schemaResp.schema;
  if (!schemaDefinition) {
    return undefined;
  }
  // Avro schemas show up as `schemaType: undefined` in the response
  if (schemaResp.schemaType === "JSON" || schemaResp.schemaType === undefined) {
    try {
      // it's already JSON-stringified, so parse and re-stringify with pretty-printing
      schemaDefinition = JSON.stringify(JSON.parse(schemaDefinition), null, 2);
    } catch {
      // if the schema content can't be stringified, just use the raw content
    }
  }
  return schemaDefinition;
}

/**
 * Convert a {@link Schema} to a URI and render via the {@link SchemaDocumentProvider} as a read-
 * only document in a new editor tab.
 */
export async function loadOrCreateSchemaViewer(schema: Schema): Promise<vscode.TextEditor> {
  const uri: vscode.Uri = new SchemaDocumentProvider().resourceToUri(schema, schema.fileName());
  const textDoc = await vscode.window.showTextDocument(uri, { preview: false });

  await setEditorLanguageForSchema(textDoc, schema.type);

  return textDoc;
}

/**
 * Possibly set the language of the editor's document based on the schema.
 * Depends on what languages the user has installed.
 */
export async function setEditorLanguageForSchema(textDoc: vscode.TextEditor, type: SchemaType) {
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
