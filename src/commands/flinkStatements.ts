import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import { FlinkStatementDocumentProvider } from "../documentProviders/flinkStatement";
import {
  extractResponseBody,
  isResponseError,
  logError,
  showErrorNotificationWithButtons,
} from "../errors";
import { Logger } from "../logging";
import { FlinkStatement, restFlinkStatementToModel } from "../models/flinkStatement";
import { CCloudKafkaCluster, KafkaCluster } from "../models/kafkaCluster";
import { flinkComputePoolQuickPick } from "../quickpicks/flinkComputePools";
import { kafkaClusterQuickPick } from "../quickpicks/kafkaClusters";
import { uriQuickpick } from "../quickpicks/uris";
import { logUsage, UserEvent } from "../telemetry/events";
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
export async function submitFlinkStatementCommand(): Promise<void> {
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

  try {
    const restResponse = await submitFlinkStatement(submission);
    logger.info(`sumbitFlinkStatementCommand response: ${JSON.stringify(restResponse, null, 2)}`);
    const newStatement = restFlinkStatementToModel(restResponse);

    if (newStatement.status.phase === "FAILED") {
      // Immediate death of the statement.

      logUsage(UserEvent.FlinkStatementAction, {
        action: "submit_failure",
        compute_pool_id: computePool.id,
        failure_reason: newStatement.status.detail,
      });

      logger.error(
        "sumbitFlinkStatementCommand",
        `Statement failed: ${newStatement.status.detail}`,
      );
      await showErrorNotificationWithButtons(
        `Error submitting statement: ${newStatement.status.detail}`,
      );
      return;
    }

    logUsage(UserEvent.FlinkStatementAction, {
      action: "submit_success",
      sql_kind: newStatement.sqlKind,
      compute_pool_id: computePool.id,
    });

    // Refresh the statements view onto the compute pool in question,
    // which will then show the new statement.
    await selectPoolForStatementsViewCommand(computePool);

    // TODO indicate to the view to highlight the new statement
    // (similar to how we did we creating new schema subjects or versions)
    // Something like:
    // await FlinkStatementsViewProvider.getInstance().revealStatement(newStatement);

    // TODO open up statement results view (invoke Rohit work here once both in main)
  } catch (err) {
    logError(err, "Submit Flink statement unexpected error");

    if (isResponseError(err) && err.response.status === 400) {
      // will be array of objs with 'details' human readable messages.
      const responseErrors: { errors: [{ detail: string }] } = await extractResponseBody(err);
      logger.error(JSON.stringify(responseErrors, null, 2));

      const errorMessages = responseErrors.errors
        .map((e: { detail: string }) => e.detail)
        .join("\n");
      await showErrorNotificationWithButtons(`Error submitting statement: ${errorMessages}`);
    } else {
      await showErrorNotificationWithButtons(`Error submitting statement: ${err}`);
    }
  }
}

export function registerFlinkStatementCommands(): vscode.Disposable[] {
  return [
    registerCommandWithLogging("confluent.statements.viewstatementsql", viewStatementSqlCommand),
    registerCommandWithLogging("confluent.statements.create", submitFlinkStatementCommand),
  ];
}
