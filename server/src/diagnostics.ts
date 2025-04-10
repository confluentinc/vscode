import type { ParseError } from "dt-sql-parser";
import { FlinkSQL } from "dt-sql-parser";
import { Diagnostic, DiagnosticSeverity } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { getConnection } from "./connection";

export async function validateTextDocument(textDocument: TextDocument): Promise<Diagnostic[]> {
  const connection = getConnection();

  const flinkSql = new FlinkSQL();
  const text = textDocument.getText();
  const diagnostics: Diagnostic[] = [];

  const errors: ParseError[] = flinkSql.validate(text);
  if (errors.length > 0) {
    errors.forEach((error) => {
      const diagnostic: Diagnostic = {
        severity: DiagnosticSeverity.Error,
        range: {
          start: { line: error.startLine - 1, character: error.startColumn - 1 },
          end: { line: error.endLine - 1, character: error.endColumn - 1 },
        },
        message: error.message,
        source: "Confluent: Flink SQL",
      };
      diagnostics.push(diagnostic);
    });
  }

  connection.console.log(`Found ${diagnostics.length} diagnostic(s)`);
  return diagnostics;
}
