import { readFile } from "fs";
import { Diagnostic, DiagnosticCollection, Position, Range, Uri, languages } from "vscode";
import {
  DocumentUri,
  JSONSchema,
  Diagnostic as JsonDiagnostic,
  TextDocument,
  getLanguageService,
} from "vscode-json-languageservice";
import { Logger } from "../logging";
import { loadDocumentContent } from "../quickpicks/uris";

const logger = new Logger("schemas.validateDocument");

export async function validateDocument(
  documentUri: Uri,
  schema: JSONSchema,
): Promise<DiagnosticCollection> {
  // vscode-json-languageservice requires DocumentUri (string) type instead of vscode.Uri
  const textDocUri: DocumentUri = documentUri.toString();

  const { content } = await loadDocumentContent(documentUri);
  const textDocument = TextDocument.create(textDocUri, "json", 1, content);

  // JSON language service setup and initial document parsing
  const jsonLanguageService = getLanguageService({
    schemaRequestService: () => {
      return Promise.resolve(JSON.stringify(schema));
    },
  });
  jsonLanguageService.configure({
    allowComments: false,
    schemas: [{ fileMatch: ["*.json"], uri: "schema", schema }],
  });
  const jsonDocument = jsonLanguageService.parseJSONDocument(textDocument);

  // validate the document against the schema
  const diagnostics: JsonDiagnostic[] = await jsonLanguageService.doValidation(
    textDocument,
    jsonDocument,
    { schemaValidation: "error" },
    schema,
  );
  // convert from vscode-json-languageservice Diagnostic to vscode Diagnostic
  const diags: Diagnostic[] = diagnostics.map((d) => {
    return new Diagnostic(
      new Range(
        new Position(d.range.start.line, d.range.start.character),
        new Position(d.range.end.line, d.range.end.character),
      ),
      d.message,
      d.severity !== undefined ? d.severity - 1 : 1, // error by default
    );
  });
  if (diags.length > 0) {
    logger.warn(`Document ${documentUri.fsPath} has ${diags.length} validation errors`);
  }

  // TODO: try out `jsonLanguageService.doComplete()`

  // apply diagnostics to the document so they show up in the Problems panel
  const collection: DiagnosticCollection = languages.createDiagnosticCollection("jsonValidator");
  collection.set(documentUri, diags);
  // TODO: on document close/rename, clear diagnostics

  return collection;
}

export async function loadSchemaFromUri(uri: Uri): Promise<JSONSchema> {
  return new Promise((resolve, reject) => {
    readFile(uri.fsPath, "utf8", (err, data) => {
      if (err) {
        return reject(err);
      }
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(e);
      }
    });
  });
}
