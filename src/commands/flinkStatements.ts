import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import { FlinkStatementDocumentProvider } from "../documentProviders/flinkStatement";
import { Logger } from "../logging";
import { FlinkStatement } from "../models/flinkStatement";
import { CCloudKafkaCluster, KafkaCluster } from "../models/kafkaCluster";
import { flinkComputePoolQuickPick } from "../quickpicks/flinkComputePools";
import { kafkaClusterQuickPick } from "../quickpicks/kafkaClusters";
import { uriQuickpick } from "../quickpicks/uris";
import { getEditorOrFileContents } from "../utils/file";
import { selectPoolForStatementsViewCommand } from "./flinkComputePools";
import {
  determineFlinkStatementName,
  FlinkSpecProperties,
  IFlinkStatementSubmitParameters,
  submitFlinkStatement,
} from "./utils/flinkStatements";

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

  const uri = FlinkStatementDocumentProvider.getStatementDocumentUri(statement);
  const doc = await vscode.workspace.openTextDocument(uri);
  vscode.languages.setTextDocumentLanguage(doc, "flinksql");
  await vscode.window.showTextDocument(doc, { preview: false });
}

/**
   * Proposed user flow:
  1. Open / create new document
  2. User types in SQL, preferrably with language server help.
  3. Hits new 'submit statement' button in the flink statement titlebar -- use the 'cloud' icon
  4. Quickpick flow:

	  1) Chose document
    2) Statement name (auto-generated from template pattern, but user can override)
	  2) the Flink cluster to send to
    3) also need to know at least the 'current database' (cluster name) to submit along with the catalog name (the env, infer-able from the chosen Flink cluster).
  5) Submit!
  6) Raise error box if any immediate submission errors.
  7) Refresh the statements view if the view is set to include the cluster
   */
export async function sumbitFlinkStatementCommand(): Promise<void> {
  // 1. Choose the document with the SQL to submit
  const uriSchemes = ["file", "untitled"];
  // XXX todo find out if we have constant for our flinksql language id.
  const languageIds = ["plaintext", "flinksql", "sql"];
  const fileFilters = {
    "FlinkSQL files": [".flinksql", ".sql"],
  };
  const statementBodyUri: vscode.Uri | undefined = await uriQuickpick(
    uriSchemes,
    languageIds,
    fileFilters,
  );
  if (!statementBodyUri) {
    return;
  }

  const document = await getEditorOrFileContents(statementBodyUri);
  const statement = document.content;

  logger.info("sumbitFlinkStatementCommand", `statementBodyUri: ${statementBodyUri.toString()}`);

  // 2. Choose the statement name
  const statementName = await determineFlinkStatementName();
  logger.info("sumbitFlinkStatementCommand", `statementName: ${statementName}`);

  // 3. Choose the Flink cluster to send to
  const computePool = await flinkComputePoolQuickPick();
  if (!computePool) {
    logger.error("sumbitFlinkStatementCommand", "computePool is undefined");
    return;
  }
  logger.info("sumbitFlinkStatementCommand", `computePool: ${computePool.name}`);

  // 4. Choose the current / default database / aka kafka cluster
  // within the environment.
  const currentDatabaseKafkaCluster: KafkaCluster | undefined = await kafkaClusterQuickPick({
    placeHolder: "Select the Kafka cluster to use as the default database for the statement",
    filter: (cluster: KafkaCluster) => {
      if (cluster.environmentId !== computePool.environmentId) {
        return false;
      }
      // Any survivors matching environmentId check should be CCloudKafkaClusters,
      // since the compute pool is ccloud.
      const ccloudCluster = cluster as CCloudKafkaCluster;
      return (
        ccloudCluster.provider === computePool.provider &&
        ccloudCluster.region === computePool.region
      );
    },
  });
  if (!currentDatabaseKafkaCluster) {
    logger.error("sumbitFlinkStatementCommand", "currentDatabaseKafkaCluster is undefined");
    return;
  }
  const currentDatabase = currentDatabaseKafkaCluster.name;

  // 5. Prep to submit, submit.
  const submission: IFlinkStatementSubmitParameters = {
    statement,
    statementName,
    computePool,
    properties: new FlinkSpecProperties({
      currentDatabase,
      currentCatalog: computePool.environmentId,
      localTimezone: "GMT-04:00",
    }),
  };
  logger.info("sumbitFlinkStatementCommand", `submission: ${JSON.stringify(submission)}`);

  const response = await submitFlinkStatement(submission);

  logger.info(`sumbitFlinkStatementCommand response: ${JSON.stringify(response, null, 2)}`);

  // Refresh the statements view onto the compute pool in question,
  // which will then show the new statement.
  await selectPoolForStatementsViewCommand(computePool);
}

export function registerFlinkStatementCommands(): vscode.Disposable[] {
  return [
    registerCommandWithLogging("confluent.statements.viewstatementsql", viewStatementSqlCommand),
    registerCommandWithLogging("confluent.statements.create", sumbitFlinkStatementCommand),
  ];
}
