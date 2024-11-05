import * as vscode from "vscode";
import { ResourceDocumentProvider } from ".";
import { SchemaString, SchemasV1Api } from "../clients/schemaRegistryRest";
import { Schema } from "../models/schema";
import { getSidecar } from "../sidecar";

export class SchemaDocumentProvider extends ResourceDocumentProvider {
  scheme = "confluent.schema";

  public async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const schemaObj: Schema = this.parseUriQueryBody(uri.query) as Schema;
    // recreate the Schema instance so we can access the .connectionId getter
    const schema = Schema.create(schemaObj);
    // fetch the schema definition from the sidecar and attempt to prettify it before displaying
    const client: SchemasV1Api = (await getSidecar()).getSchemasV1Api(
      schema.schemaRegistryId,
      schema.connectionId,
    );
    const schemaResp: SchemaString = await client.getSchema({ id: Number(schema.id) });
    const schemaDefinition: string | null = prettifySchemaDefinition(schemaResp);
    if (!schemaDefinition) {
      throw new Error("Failed to load schema definition; it may be empty or invalid.");
    }
    return schemaDefinition;
  }
}

/**
 * Attempt to prettify a schema definition for display in a read-only editor tab.
 * @param schemaResp The schema response object from the Schema Registry REST API
 * @returns The prettified schema definition, or null if the schema content is empty or invalid
 */
function prettifySchemaDefinition(schemaResp: SchemaString): string | null {
  let schemaDefinition = schemaResp.schema;
  if (!schemaDefinition) {
    return null;
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
