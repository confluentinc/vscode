import * as vscode from "vscode";
import { ResourceDocumentProvider } from ".";
import { TokenManager } from "../auth/oauth2/tokenManager";
import type { SchemaString } from "../clients/schemaRegistryRest";
import { ConnectionType, CredentialType } from "../connections";
import { ResourceLoader } from "../loaders";
import { Logger } from "../logging";
import { getLanguageTypes, Schema, SchemaType } from "../models/schema";
import type { AuthConfig } from "../proxy/httpClient";
import * as schemaRegistryProxy from "../proxy/schemaRegistryProxy";
import { getResourceManager } from "../storage/resourceManager";

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
  if (!schema.environmentId) {
    throw new Error("Schema is missing environmentId, cannot fetch body");
  }

  // Get the schema registry for this schema
  const loader = ResourceLoader.getInstance(schema.connectionId);
  const schemaRegistry = await loader.getSchemaRegistryForEnvironmentId(schema.environmentId);
  if (!schemaRegistry) {
    throw new Error(`No schema registry found for environment ${schema.environmentId}`);
  }

  // Get auth config based on connection type
  const auth = await getAuthConfigForSchemaRegistry(schema);

  // Create a proxy to fetch the schema content
  const proxy = schemaRegistryProxy.createSchemaRegistryProxy({
    baseUrl: schemaRegistry.uri,
    auth,
  });

  // Fetch the schema string content using the schema version endpoint
  // getSchemaString returns the schema definition as a string directly
  const schemaContent = await proxy.getSchemaString(schema.subject, schema.version);

  if (!schemaContent) {
    throw new Error("Failed to load schema definition; it may be empty or invalid.");
  }

  // Build a SchemaString object for prettifying
  const schemaString: SchemaString = {
    schema: schemaContent,
    schemaType: schema.type,
  };

  if (prettified) {
    const prettySchema = prettifySchemaDefinition(schemaString);
    if (!prettySchema) {
      throw new Error("Failed to load schema definition; it may be empty or invalid.");
    }
    return prettySchema;
  }

  return schemaContent;
}

/**
 * Get authentication configuration for a Schema Registry based on connection type.
 */
async function getAuthConfigForSchemaRegistry(schema: Schema): Promise<AuthConfig | undefined> {
  switch (schema.connectionType) {
    case ConnectionType.Ccloud: {
      // CCloud uses bearer token authentication
      const token = (await TokenManager.getInstance().getDataPlaneToken()) || "";
      return {
        type: "bearer",
        token,
      };
    }
    case ConnectionType.Direct: {
      // Direct connections may have credentials stored
      const resourceManager = getResourceManager();
      const spec = await resourceManager.getDirectConnection(schema.connectionId);
      if (spec?.schemaRegistry?.credentials) {
        const creds = spec.schemaRegistry.credentials;

        // Use the credential's type discriminator for typed access
        if (creds.type === CredentialType.BASIC) {
          return {
            type: "basic",
            username: creds.username,
            password: creds.password,
          };
        }
        if (creds.type === CredentialType.API_KEY) {
          // API keys are sent as basic auth with key:secret
          return {
            type: "basic",
            username: creds.apiKey,
            password: creds.apiSecret,
          };
        }
        if (creds.type === CredentialType.SCRAM) {
          // SCRAM credentials are sent as basic auth
          return {
            type: "basic",
            username: creds.username,
            password: creds.password,
          };
        }
      }
      return undefined;
    }
    case ConnectionType.Local:
    default:
      // Local connections typically don't require authentication
      return undefined;
  }
}

/**
 * Attempt to prettify a schema definition for display in a read-only editor tab.
 * @param schemaResp The schema response object from the Schema Registry REST API
 * @returns The prettified schema definition, or undefined if the schema content is empty or invalid
 */
export function prettifySchemaDefinition(schemaResp: SchemaString): string | undefined {
  let schemaDefinition = schemaResp.schema;
  if (!schemaDefinition) {
    return undefined;
  }
  // Avro schemas typically show up as `schemaType: undefined` in the response, but we'll
  // also check for "AVRO" explicitly
  if (
    schemaResp.schemaType === undefined ||
    [SchemaType.Avro, SchemaType.Json].includes(schemaResp.schemaType as SchemaType)
  ) {
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
export async function openReadOnlySchemaDocument(schema: Schema): Promise<vscode.TextEditor> {
  const uri: vscode.Uri = new SchemaDocumentProvider().resourceToUri(schema, schema.fileName());
  const editor: vscode.TextEditor = await vscode.window.showTextDocument(uri, { preview: false });

  await setLanguageForSchemaEditor(editor, schema.type);

  return editor;
}

/**
 * Possibly set the language of the editor's document based on the schema.
 * Depends on what languages the user has installed.
 */
export async function setLanguageForSchemaEditor(editor: vscode.TextEditor, type: SchemaType) {
  const installedLanguages: string[] = await vscode.languages.getLanguages();
  const languageTypes: string[] = getLanguageTypes(type);

  for (const language of languageTypes) {
    if (installedLanguages.includes(language)) {
      await vscode.languages.setTextDocumentLanguage(editor.document, language);
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

  logger.warn(
    `Could not find a matching language for ${type}, using the first one: ${preferredLanguage}`,
  );
}
