import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import { Logger } from "../logging";
import { FlinkStatement } from "../models/flinkStatement";

const logger = new Logger("commands.flinkStatements");

export async function viewStatementSqlCommand(statement: FlinkStatement): Promise<void> {
  if (!statement) {
    logger.error("viewStatementSqlCommand", "statement is undefined");
    return;
  }

  if (!(statement instanceof FlinkStatement)) {
    logger.error("viewStatementSqlCommand", "statement is not an instance of FlinkStatement");
    return;
  }

  logger.debug("viewStatementSqlCommand", statement.sqlStatement);
}

export function registerFlinkStatementCommands(): vscode.Disposable[] {
  return [
    registerCommandWithLogging("confluent.statements.viewstatementsql", viewStatementSqlCommand),
  ];
}
