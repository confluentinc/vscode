import { TextDocuments } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { getConnection } from "./connection.js";

let docManager: TextDocuments<TextDocument>;

export function getDocumentManager() {
  if (!docManager) {
    const connection = getConnection();
    docManager = new TextDocuments(TextDocument);
    docManager.listen(connection);
  }
  return docManager;
}
