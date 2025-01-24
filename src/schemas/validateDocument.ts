import {
  Diagnostic,
  DiagnosticCollection,
  Disposable,
  Position,
  Range,
  TextDocument,
  TextDocumentChangeEvent,
  Uri,
  workspace,
} from "vscode";
import {
  JSONDocument,
  JSONSchema,
  Diagnostic as JsonDiagnostic,
  TextDocument as JsonTextDocument,
  getLanguageService,
} from "vscode-json-languageservice";
import { Logger } from "../logging";
import { loadDocumentContent } from "../quickpicks/uris";
import { JSON_DIAGNOSTIC_COLLECTION } from "./diagnosticCollection";

const logger = new Logger("schemas.validateDocument");

/**
 * Validate a JSON document against a {@link JSONSchema} and sets its {@link DiagnosticCollection}
 * against the provided document Uri.
 * @returns Workspace document listener {@link Disposable}s that will clear diagnostics when disposed.
 */
export async function validateDocument(
  documentUri: Uri,
  schema: JSONSchema,
): Promise<Disposable[]> {
  const { content } = await loadDocumentContent(documentUri);
  if (!content) {
    logger.error(`no content found for document ${documentUri}`);
    return [];
  }

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
  // vscode-json-languageservice requires DocumentUri (string) type instead of vscode.Uri
  const textDocument: JsonTextDocument = JsonTextDocument.create(
    documentUri.toString(),
    "json",
    1,
    content,
  );
  const jsonDocument: JSONDocument = jsonLanguageService.parseJSONDocument(textDocument);

  // validate the document against the schema
  // (no idea why we need to pass both the document and the parsed document)
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

  // TODO: try out `jsonLanguageService.doComplete()`

  // apply diagnostics to the document so they show up in the Problems panel
  JSON_DIAGNOSTIC_COLLECTION.set(documentUri, diags);

  // on document close/rename, clear diagnostics
  const docCloseSub: Disposable = workspace.onDidCloseTextDocument((e: TextDocument) => {
    if (e.uri.fsPath === documentUri.fsPath) {
      JSON_DIAGNOSTIC_COLLECTION.delete(documentUri);
      docCloseSub.dispose();
    }
  });
  // if the document is modified, re-validate
  const docChangeSub: Disposable = workspace.onDidChangeTextDocument(
    (e: TextDocumentChangeEvent) => {
      if (e.document.uri.fsPath === documentUri.fsPath && e.contentChanges.length > 0) {
        JSON_DIAGNOSTIC_COLLECTION.delete(documentUri);
        docChangeSub.dispose();
        validateDocument(documentUri, schema);
      }
    },
  );

  return [docCloseSub, docChangeSub];
}
