import { DiagnosticCollection, languages } from "vscode";

/** The name of the diagnostic collection for JSON validation. */
const JSON_DIAGNOSTIC_COLLECTION_NAME = "confluent.json";

/** The main diagnostic collection used for any JSON validation performed by this extension. */
export const JSON_DIAGNOSTIC_COLLECTION: DiagnosticCollection =
  languages.createDiagnosticCollection(JSON_DIAGNOSTIC_COLLECTION_NAME);
