import { Diagnostic, DiagnosticSeverity } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { getConnection } from "./connection.js";

export async function validateTextDocument(textDocument: TextDocument): Promise<Diagnostic[]> {
  const connection = getConnection();

  let flinkSql;
  try {
    const parser = await import("dt-sql-parser");
    flinkSql = new parser.FlinkSQL();
  } catch (error) {
    connection.console.error(`Error importing parser: ${error}`);
    return [];
  }

  const text = textDocument.getText();
  const diagnostics: Diagnostic[] = [];

  const errors = flinkSql.validate(text);
  if (errors.length > 0) {
    errors.forEach((error) => {
      const diagnostic: Diagnostic = {
        severity: DiagnosticSeverity.Error,
        range: {
          start: { line: error.startLine, character: error.startColumn },
          end: { line: error.endLine, character: error.endColumn },
        },
        message: error.message,
        source: "Flink SQL",
      };
      diagnostics.push(diagnostic);
    });
  }

  connection.console.log(`Found ${diagnostics.length} diagnostic(s)`);
  return diagnostics;
}
