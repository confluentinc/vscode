import * as vscode from "vscode";
import { ResourceDocumentProvider } from ".";
import { FlinkStatement } from "../models/flinkStatement";

/** The URI scheme for read-only flink statements, used by FlinkStatementDocumentProvider. */
export const FLINKSTATEMENT_URI_SCHEME = "confluent.flinkstatement";

/**
 * Minimal interface for the URI query string portion of a FlinkStatement.
 * The resulting URIs are then durably stored in the workspace's open file list.
 */
interface FlinkStatementSQL {
  sqlStatement: string;
}

/** Makes a read-only editor buffer holding a flink SQL statement */
export class FlinkStatementDocumentProvider extends ResourceDocumentProvider {
  scheme = FLINKSTATEMENT_URI_SCHEME;

  /**
   * Provide the text contents given a URI for this document provider scheme.
   * Simply extracts the SQL statement from the URI query string and returns it.
   */
  public async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    // parse the URI query string into a FlinkStatementSQL instance, given that all
    // our document URIs should have been created with the getStatementDocumentUri() method.
    const fromUriQuery: FlinkStatementSQL = this.parseUriQueryBody(uri.query) as FlinkStatementSQL;

    return fromUriQuery.sqlStatement;
  }

  /** Encode the SQL statement portion of the FlinkStatment into URI's query string. */
  static getStatementDocumentUri(statement: FlinkStatement): vscode.Uri {
    return ResourceDocumentProvider.baseResourceToUri(
      FLINKSTATEMENT_URI_SCHEME,
      { sqlStatement: statement.sqlStatement } as FlinkStatementSQL,
      statement.name,
    );
  }
}
