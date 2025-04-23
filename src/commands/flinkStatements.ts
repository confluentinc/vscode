import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import { ActiveFlinkStatementProvider } from "../documentProviders/flinkStatement";
import { Logger } from "../logging";
import { FlinkStatement } from "../models/flinkStatement";
import { FlinkStatementsViewProvider } from "../viewProviders/flinkStatements";

const logger = new Logger("commands.flinkStatements");

/** View the SQL statement portion of a FlinkStatement in a read-only document. */
export async function viewStatementSqlCommand(statement: FlinkStatement): Promise<void> {
  if (!statement) {
    logger.error("viewStatementSqlCommand", "statement is undefined");
    return;
  }

  if (!(statement instanceof FlinkStatement)) {
    logger.error("viewStatementSqlCommand", "statement is not an instance of FlinkStatement");
    return;
  }

  const provider = ActiveFlinkStatementProvider.getInstance();

  provider.setStatement(statement);

  const doc = await vscode.workspace.openTextDocument(provider.ACTIVE_URI);
  vscode.languages.setTextDocumentLanguage(doc, "flinksql");
  await vscode.window.showTextDocument(doc, { preview: false });
}

/** Refresh the statements view. */
export function refreshFlinkStatementViewCommand(): void {
  const provider = FlinkStatementsViewProvider.getInstance();
  provider.refresh();
}

export function registerFlinkStatementCommands(): vscode.Disposable[] {
  return [
    registerCommandWithLogging("confluent.statements.refresh", refreshFlinkStatementViewCommand),
    registerCommandWithLogging("confluent.statements.viewstatementsql", viewStatementSqlCommand),
  ];
}
