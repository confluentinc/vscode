import assert from "assert";
import sinon from "sinon";
import * as vscode from "vscode";

import { TextDocument } from "vscode-json-languageservice";
import { eventEmitterStubs } from "../../tests/stubs/emitters";
import { getStubbedCCloudResourceLoader } from "../../tests/stubs/resourceLoaders";
import {
  TEST_CCLOUD_ENVIRONMENT,
  TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
  TEST_CCLOUD_KAFKA_CLUSTER,
} from "../../tests/unit/testResources";
import { TEST_CCLOUD_FLINK_COMPUTE_POOL } from "../../tests/unit/testResources/flinkComputePool";
import { createFlinkStatement } from "../../tests/unit/testResources/flinkStatement";
import * as flinkCodeLens from "../codelens/flinkSqlProvider";
import { FLINK_SQL_LANGUAGE_ID } from "../flinkSql/constants";
import * as statementUtils from "../flinkSql/statementUtils";
import { CCloudResourceLoader } from "../loaders";
import { CCloudEnvironment } from "../models/environment";
import { FlinkStatement, Phase } from "../models/flinkStatement";
import { CCloudFlinkDbKafkaCluster } from "../models/kafkaCluster";
import * as notifications from "../notifications";
import { UriMetadataKeys } from "../storage/constants";
import { ResourceManager } from "../storage/resourceManager";
import {
  deleteFlinkStatementCommand,
  handleStatementSubmission,
  stopFlinkStatementCommand,
  viewStatementSqlCommand,
} from "./flinkStatements";
import * as statementsUtils from "./utils/statements";

describe("commands/flinkStatements.ts", () => {
  let sandbox: sinon.SinonSandbox;
  let stubbedLoader: sinon.SinonStubbedInstance<CCloudResourceLoader>;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    stubbedLoader = getStubbedCCloudResourceLoader(sandbox);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("viewStatementSqlCommand", () => {
    let getCatalogDatabaseFromMetadataStub: sinon.SinonStub;
    let openTextDocumentStub: sinon.SinonStub;
    let showTextDocumentStub: sinon.SinonStub;
    let setUriMetadataStub: sinon.SinonStub;

    beforeEach(() => {
      getCatalogDatabaseFromMetadataStub = sandbox.stub(
        flinkCodeLens,
        "getCatalogDatabaseFromMetadata",
      );
      openTextDocumentStub = sandbox.stub(vscode.workspace, "openTextDocument");
      showTextDocumentStub = sandbox.stub(vscode.window, "showTextDocument");
      setUriMetadataStub = sandbox.stub(ResourceManager.getInstance(), "setUriMetadata");
    });

    it("should hate undefined statement", async () => {
      const result = await viewStatementSqlCommand(undefined as unknown as FlinkStatement);
      assert.strictEqual(result, undefined);
    });

    it("should hate non-FlinkStatement statement", async () => {
      const result = await viewStatementSqlCommand({} as FlinkStatement);
      assert.strictEqual(result, undefined);
    });

    it("should open an untitled document for a FlinkStatement", async () => {
      const testPool = TEST_CCLOUD_FLINK_COMPUTE_POOL;
      const testEnv = new CCloudEnvironment({
        ...TEST_CCLOUD_ENVIRONMENT,
        flinkComputePools: [testPool],
      });
      stubbedLoader.getEnvironments.resolves([testEnv]);
      stubbedLoader.getFlinkComputePool.resolves(testPool);
      getCatalogDatabaseFromMetadataStub.returns({
        catalog: testEnv,
        database: TEST_CCLOUD_KAFKA_CLUSTER,
      });
      const testSqlStatement = "SELECT * FROM my_test_flink_statement_table";
      const testDoc = {
        language: FLINK_SQL_LANGUAGE_ID,
        content: testSqlStatement,
        uri: vscode.Uri.parse("untitled:SELECT1"),
      } as unknown as TextDocument;
      openTextDocumentStub.resolves(testDoc);

      const statement = createFlinkStatement({
        sqlStatement: testSqlStatement,
      });

      await viewStatementSqlCommand(statement);

      sinon.assert.calledOnce(stubbedLoader.getFlinkComputePool);
      sinon.assert.calledWithExactly(stubbedLoader.getFlinkComputePool, statement.computePoolId!);

      sinon.assert.calledOnce(getCatalogDatabaseFromMetadataStub);
      sinon.assert.calledWithExactly(
        getCatalogDatabaseFromMetadataStub,
        {
          [UriMetadataKeys.FLINK_COMPUTE_POOL_ID]: statement.computePoolId,
          [UriMetadataKeys.FLINK_CATALOG_NAME]: statement.catalog,
          [UriMetadataKeys.FLINK_DATABASE_NAME]: statement.database,
        },
        testPool,
      );

      sinon.assert.calledOnce(showTextDocumentStub);
      const document: TextDocument = showTextDocumentStub.firstCall.args[0];
      assert.strictEqual(vscode.Uri.parse(document.uri).scheme, "untitled");
      sinon.assert.calledWithExactly(showTextDocumentStub, document, { preview: false });
    });

    it("should set Uri metadata before showing the document", async () => {
      const testPool = TEST_CCLOUD_FLINK_COMPUTE_POOL;
      const testEnv = new CCloudEnvironment({
        ...TEST_CCLOUD_ENVIRONMENT,
        flinkComputePools: [testPool],
      });
      stubbedLoader.getEnvironments.resolves([testEnv]);
      stubbedLoader.getFlinkComputePool.resolves(testPool);
      getCatalogDatabaseFromMetadataStub.returns({
        catalog: testEnv,
        database: TEST_CCLOUD_KAFKA_CLUSTER,
      });
      const testSqlStatement = "SELECT * FROM my_test_flink_statement_table";
      const testDoc = {
        language: FLINK_SQL_LANGUAGE_ID,
        content: testSqlStatement,
        uri: vscode.Uri.parse("untitled:SELECT1"),
      } as unknown as TextDocument;
      openTextDocumentStub.resolves(testDoc);

      const statement = createFlinkStatement({
        sqlStatement: testSqlStatement,
      });

      await viewStatementSqlCommand(statement);

      sinon.assert.calledOnce(openTextDocumentStub);
      sinon.assert.calledOnceWithExactly(openTextDocumentStub, {
        language: FLINK_SQL_LANGUAGE_ID,
        content: statement.sqlStatement,
      });
      sinon.assert.calledOnce(setUriMetadataStub);
      const callArgs = setUriMetadataStub.firstCall.args;
      assert.strictEqual(callArgs.length, 2);
      assert.strictEqual(callArgs[0].toString(), testDoc.uri.toString());
      assert.deepStrictEqual(callArgs[1], {
        [UriMetadataKeys.FLINK_COMPUTE_POOL_ID]: statement.computePoolId,
        [UriMetadataKeys.FLINK_CATALOG_ID]: TEST_CCLOUD_ENVIRONMENT.id,
        [UriMetadataKeys.FLINK_CATALOG_NAME]: statement.catalog,
        [UriMetadataKeys.FLINK_DATABASE_ID]: TEST_CCLOUD_KAFKA_CLUSTER.id,
        [UriMetadataKeys.FLINK_DATABASE_NAME]: statement.database,
      });
      sinon.assert.callOrder(openTextDocumentStub, setUriMetadataStub, showTextDocumentStub);
    });
  });

  describe("deleteFlinkStatementCommand and stopFlinkStatementCommand", () => {
    let showInformationMessageStub: sinon.SinonStub;
    let showErrorNotificationWithButtonsStub: sinon.SinonStub;
    let confirmActionOnStatementStub: sinon.SinonStub;

    beforeEach(() => {
      showInformationMessageStub = sandbox.stub(vscode.window, "showInformationMessage");
      showErrorNotificationWithButtonsStub = sandbox.stub(
        notifications,
        "showErrorNotificationWithButtons",
      );
      confirmActionOnStatementStub = sandbox.stub(statementsUtils, "confirmActionOnStatement");
    });

    describe("deleteFlinkStatementCommand", () => {
      it("should hate undefined statement", async () => {
        await deleteFlinkStatementCommand(undefined as unknown as FlinkStatement);
        sinon.assert.notCalled(stubbedLoader.deleteFlinkStatement);
        sinon.assert.notCalled(showInformationMessageStub);
        sinon.assert.notCalled(showErrorNotificationWithButtonsStub);
      });

      it("should hate non-FlinkStatement statement", async () => {
        await deleteFlinkStatementCommand({} as FlinkStatement);
        sinon.assert.notCalled(stubbedLoader.deleteFlinkStatement);
        sinon.assert.notCalled(showInformationMessageStub);
        sinon.assert.notCalled(showErrorNotificationWithButtonsStub);
      });

      it("should show error if statement is stoppable (should not have offered the delete action in first place)", async () => {
        const statement = createFlinkStatement({ phase: Phase.RUNNING });
        await deleteFlinkStatementCommand(statement);

        sinon.assert.notCalled(confirmActionOnStatementStub);
        sinon.assert.notCalled(stubbedLoader.deleteFlinkStatement);
        sinon.assert.notCalled(showInformationMessageStub);

        sinon.assert.calledOnce(showErrorNotificationWithButtonsStub);
        sinon.assert.calledWithExactly(
          showErrorNotificationWithButtonsStub,
          `Statement ${statement.name} is not in a deletable state (${statement.status.phase})`,
        );
      });

      it("should delete a valid FlinkStatement", async () => {
        confirmActionOnStatementStub.resolves(true);
        const statement = createFlinkStatement({ phase: Phase.COMPLETED });

        await deleteFlinkStatementCommand(statement);

        sinon.assert.calledOnce(confirmActionOnStatementStub);
        sinon.assert.calledWithExactly(confirmActionOnStatementStub, "delete", statement);
        sinon.assert.calledOnce(stubbedLoader.deleteFlinkStatement);
        sinon.assert.calledWithExactly(stubbedLoader.deleteFlinkStatement, statement);

        sinon.assert.calledOnce(showInformationMessageStub);
        sinon.assert.calledWithExactly(
          showInformationMessageStub,
          `Deleted statement ${statement.name}`,
        );

        sinon.assert.notCalled(showErrorNotificationWithButtonsStub);
      });

      it("should not delete a FlinkStatement if user cancels confirmation", async () => {
        confirmActionOnStatementStub.resolves(false);
        const statement = createFlinkStatement({ phase: Phase.COMPLETED });

        await deleteFlinkStatementCommand(statement);

        sinon.assert.calledOnce(confirmActionOnStatementStub);
        sinon.assert.calledWithExactly(confirmActionOnStatementStub, "delete", statement);
        sinon.assert.notCalled(stubbedLoader.deleteFlinkStatement);
        sinon.assert.notCalled(showInformationMessageStub);
        sinon.assert.notCalled(showErrorNotificationWithButtonsStub);
      });

      it("should handle errors when deleting a FlinkStatement", async () => {
        const statement = createFlinkStatement({ phase: Phase.COMPLETED });
        const testError = new Error("Test error deleting statement");
        confirmActionOnStatementStub.resolves(true);
        stubbedLoader.deleteFlinkStatement.rejects(testError);

        await deleteFlinkStatementCommand(statement);

        sinon.assert.calledOnce(stubbedLoader.deleteFlinkStatement);
        sinon.assert.notCalled(showInformationMessageStub);

        sinon.assert.calledOnce(showErrorNotificationWithButtonsStub);
        sinon.assert.calledWithExactly(
          showErrorNotificationWithButtonsStub,
          `Error deleting statement: ${testError}`,
        );
      });
    });

    describe("stopFlinkStatementCommand", () => {
      it("should hate undefined statement", async () => {
        await stopFlinkStatementCommand(undefined as unknown as FlinkStatement);
        sinon.assert.notCalled(stubbedLoader.stopFlinkStatement);
        sinon.assert.notCalled(showInformationMessageStub);
        sinon.assert.notCalled(showErrorNotificationWithButtonsStub);
      });

      it("should hate non-FlinkStatement statement", async () => {
        await stopFlinkStatementCommand({} as FlinkStatement);
        sinon.assert.notCalled(stubbedLoader.stopFlinkStatement);
        sinon.assert.notCalled(showInformationMessageStub);
        sinon.assert.notCalled(showErrorNotificationWithButtonsStub);
      });

      it("should show error if statement not stoppable", async () => {
        const statement = createFlinkStatement({ phase: Phase.COMPLETED });
        await stopFlinkStatementCommand(statement);

        sinon.assert.notCalled(confirmActionOnStatementStub);
        sinon.assert.notCalled(stubbedLoader.stopFlinkStatement);
        sinon.assert.notCalled(showInformationMessageStub);

        sinon.assert.calledOnce(showErrorNotificationWithButtonsStub);
        sinon.assert.calledWithExactly(
          showErrorNotificationWithButtonsStub,
          `Statement ${statement.name} is not in a stoppable state (${statement.status.phase})`,
        );
      });

      it("should stop a valid FlinkStatement", async () => {
        confirmActionOnStatementStub.resolves(true);
        const statement = createFlinkStatement({ phase: Phase.RUNNING });

        await stopFlinkStatementCommand(statement);

        sinon.assert.calledOnce(confirmActionOnStatementStub);
        sinon.assert.calledWithExactly(confirmActionOnStatementStub, "stop", statement);
        sinon.assert.calledOnce(stubbedLoader.stopFlinkStatement);
        sinon.assert.calledWithExactly(stubbedLoader.stopFlinkStatement, statement);

        sinon.assert.calledOnce(showInformationMessageStub);
        sinon.assert.calledWithExactly(
          showInformationMessageStub,
          `Stopped statement ${statement.name}`,
        );

        sinon.assert.notCalled(showErrorNotificationWithButtonsStub);
      });

      it("should not stop if user cancels confirmation", async () => {
        confirmActionOnStatementStub.resolves(false);
        const statement = createFlinkStatement({ phase: Phase.RUNNING });

        await stopFlinkStatementCommand(statement);

        sinon.assert.calledOnce(confirmActionOnStatementStub);
        sinon.assert.calledWithExactly(confirmActionOnStatementStub, "stop", statement);
        sinon.assert.notCalled(stubbedLoader.stopFlinkStatement);
        sinon.assert.notCalled(showInformationMessageStub);
        sinon.assert.notCalled(showErrorNotificationWithButtonsStub);
      });

      it("should handle errors when stopping a FlinkStatement", async () => {
        const statement = createFlinkStatement({ phase: Phase.RUNNING });
        const testError = new Error("Test error stopping statement");
        confirmActionOnStatementStub.resolves(true);
        stubbedLoader.stopFlinkStatement.rejects(testError);

        await stopFlinkStatementCommand(statement);

        sinon.assert.calledOnce(stubbedLoader.stopFlinkStatement);
        sinon.assert.notCalled(showInformationMessageStub);

        sinon.assert.calledOnce(showErrorNotificationWithButtonsStub);
        sinon.assert.calledWithExactly(
          showErrorNotificationWithButtonsStub,
          `Error stopping statement: ${testError}`,
        );
      });
    });
  });

  describe("handleStatementSubmission()", () => {
    const database: CCloudFlinkDbKafkaCluster = TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER;
    let waitForStatementCompletionStub: sinon.SinonStub;
    let waitForResultsFetchableStub: sinon.SinonStub;
    let openFlinkStatementResultsViewStub: sinon.SinonStub;
    const createFuncStatement = createFlinkStatement({
      sqlStatement:
        "CREATE FUNCTION `testFunction` AS 'com.test.TestClass' USING JAR 'confluent-artifact://artifact-id';",
    });
    let stubbedUDFsChangedEmitter: sinon.SinonStubbedInstance<
      vscode.EventEmitter<CCloudFlinkDbKafkaCluster>
    >;

    beforeEach(() => {
      waitForStatementCompletionStub = sandbox.stub(statementUtils, "waitForStatementCompletion");
      waitForResultsFetchableStub = sandbox.stub(statementUtils, "waitForResultsFetchable");
      openFlinkStatementResultsViewStub = sandbox.stub(
        statementsUtils,
        "openFlinkStatementResultsView",
      );
      stubbedUDFsChangedEmitter = eventEmitterStubs(sandbox).udfsChanged!;
    });

    it("should fire udfsChanged emitter when having run a statement registering a new UDF", async () => {
      createFuncStatement.status = {
        ...createFuncStatement.status,
        phase: Phase.COMPLETED,
        traits: {
          sql_kind: "CREATE_FUNCTION",
        },
      };
      waitForStatementCompletionStub.resolves(createFuncStatement);

      await handleStatementSubmission(createFuncStatement, database);

      sinon.assert.calledWithExactly(stubbedUDFsChangedEmitter.fire, database);
    });

    it("should not fire udfsChanged for non-UDF-registering statements", async () => {
      createFuncStatement.status = {
        ...createFuncStatement.status,
        phase: Phase.COMPLETED,
        traits: {
          sql_kind: "NOT A CREATE FUNCTION",
        },
      };
      waitForStatementCompletionStub.resolves(createFuncStatement);

      await handleStatementSubmission(createFuncStatement, database);

      sinon.assert.calledOnce(waitForResultsFetchableStub);
      sinon.assert.calledOnce(openFlinkStatementResultsViewStub);
      sinon.assert.notCalled(waitForStatementCompletionStub);
      sinon.assert.notCalled(stubbedUDFsChangedEmitter.fire);
    });

    it("should not fire udfsChanged on a statement with a non-COMPLETED phase", async () => {
      const statement = createFlinkStatement({
        sqlStatement: "SELECT * FROM my_test_flink_statement_table",
      });
      statement.status = {
        ...statement.status,
        phase: Phase.RUNNING,
        traits: {
          sql_kind: "CREATE_FUNCTION",
        },
      };
      waitForStatementCompletionStub.resolves(statement);

      await handleStatementSubmission(statement, database);

      sinon.assert.calledOnce(waitForResultsFetchableStub);
      sinon.assert.calledOnce(openFlinkStatementResultsViewStub);
      sinon.assert.calledOnce(waitForStatementCompletionStub);
      sinon.assert.notCalled(stubbedUDFsChangedEmitter.fire);
    });
  });
});
