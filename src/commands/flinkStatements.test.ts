import assert from "assert";
import sinon from "sinon";
import * as vscode from "vscode";

import { TextDocument } from "vscode-json-languageservice";
import { eventEmitterStubs } from "../../tests/stubs/emitters";
import { getStubbedCCloudResourceLoader } from "../../tests/stubs/resourceLoaders";
import { TEST_CCLOUD_ENVIRONMENT, TEST_CCLOUD_KAFKA_CLUSTER } from "../../tests/unit/testResources";
import { TEST_CCLOUD_FLINK_COMPUTE_POOL } from "../../tests/unit/testResources/flinkComputePool";
import { createFlinkStatement } from "../../tests/unit/testResources/flinkStatement";
import * as flinkCodeLens from "../codelens/flinkSqlProvider";
import { FlinkStatementDocumentProvider } from "../documentProviders/flinkStatement";
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
  fireEmitterWhenFlinkStatementIsCreatingFunction,
  viewStatementSqlCommand,
} from "./flinkStatements";

describe("commands/flinkStatements.ts", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("viewStatementSqlCommand", () => {
    let stubbedLoader: sinon.SinonStubbedInstance<CCloudResourceLoader>;
    let getCatalogDatabaseFromMetadataStub: sinon.SinonStub;
    let showTextDocumentStub: sinon.SinonStub;
    let setUriMetadataStub: sinon.SinonStub;

    beforeEach(() => {
      stubbedLoader = getStubbedCCloudResourceLoader(sandbox);
      getCatalogDatabaseFromMetadataStub = sandbox.stub(
        flinkCodeLens,
        "getCatalogDatabaseFromMetadata",
      );
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

    it("should open a read-only document for a FlinkStatement", async () => {
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

      const statement = createFlinkStatement({
        sqlStatement: "SELECT * FROM my_test_flink_statement_table",
      });
      const uri = FlinkStatementDocumentProvider.getStatementDocumentUri(statement);

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
      assert.strictEqual(document.uri.toString(), uri.toString());
      sinon.assert.calledWithExactly(showTextDocumentStub, document, { preview: false });
    });

    it("should set Uri metadata before opening the document", async () => {
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

      const statement = createFlinkStatement({
        sqlStatement: "SELECT * FROM my_test_flink_statement_table",
      });
      const uri = FlinkStatementDocumentProvider.getStatementDocumentUri(statement);

      await viewStatementSqlCommand(statement);

      sinon.assert.calledOnce(setUriMetadataStub);
      const callArgs = setUriMetadataStub.firstCall.args;
      assert.strictEqual(callArgs.length, 2);
      assert.strictEqual(callArgs[0].toString(), uri.toString());
      assert.deepStrictEqual(callArgs[1], {
        [UriMetadataKeys.FLINK_COMPUTE_POOL_ID]: statement.computePoolId,
        [UriMetadataKeys.FLINK_CATALOG_ID]: TEST_CCLOUD_ENVIRONMENT.id,
        [UriMetadataKeys.FLINK_CATALOG_NAME]: statement.catalog,
        [UriMetadataKeys.FLINK_DATABASE_ID]: TEST_CCLOUD_KAFKA_CLUSTER.id,
        [UriMetadataKeys.FLINK_DATABASE_NAME]: statement.database,
      });
    });
  });

  describe("deleteFlinkStatementCommand", () => {
    let stubbedLoader: sinon.SinonStubbedInstance<CCloudResourceLoader>;
    let showInformationMessageStub: sinon.SinonStub;
    let showErrorNotificationWithButtonsStub: sinon.SinonStub;

    beforeEach(() => {
      stubbedLoader = getStubbedCCloudResourceLoader(sandbox);
      showInformationMessageStub = sandbox.stub(vscode.window, "showInformationMessage");
      showErrorNotificationWithButtonsStub = sandbox.stub(
        notifications,
        "showErrorNotificationWithButtons",
      );
    });

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

    it("should delete a valid FlinkStatement", async () => {
      const statement = createFlinkStatement();
      stubbedLoader.deleteFlinkStatement.resolves();

      await deleteFlinkStatementCommand(statement);

      sinon.assert.calledOnce(stubbedLoader.deleteFlinkStatement);
      sinon.assert.calledWithExactly(stubbedLoader.deleteFlinkStatement, statement);

      sinon.assert.calledOnce(showInformationMessageStub);
      sinon.assert.calledWithExactly(
        showInformationMessageStub,
        `Deleted statement ${statement.name}`,
      );

      sinon.assert.notCalled(showErrorNotificationWithButtonsStub);
    });

    it("should handle errors when deleting a FlinkStatement", async () => {
      const statement = createFlinkStatement();
      const testError = new Error("Test error deleting statement");
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

  describe("fireEmitterWhenFlinkStatementIsCreatingFunction", () => {
    it("should fire the emitter", async () => {
      const statement = createFlinkStatement({
        sqlStatement:
          "CREATE FUNCTION `testFunction` AS 'com.test.TestClass' USING JAR 'confluent-artifact://artifact-id';",
      });
      statement.status = {
        ...statement.status,
        phase: Phase.COMPLETED,
        traits: {
          sql_kind: "CREATE_FUNCTION",
        },
      };
      const database = TEST_CCLOUD_KAFKA_CLUSTER as CCloudFlinkDbKafkaCluster;
      const stubbedEventEmitters = eventEmitterStubs(sandbox);
      const waitForStatementCompletionStub = sandbox.stub(
        statementUtils,
        "waitForStatementCompletion",
      );
      waitForStatementCompletionStub.resolves(statement);
      const stubbedUDFsChangedEmitter = stubbedEventEmitters.udfsChanged!;
      await fireEmitterWhenFlinkStatementIsCreatingFunction(statement, database);

      sinon.assert.calledOnce(stubbedUDFsChangedEmitter.fire);
    });

    it("should not fire the emitter on other types of statements", async () => {
      const statement = createFlinkStatement({
        sqlStatement:
          "CREATE FUNCTION `testFunction` AS 'com.test.TestClass' USING JAR 'confluent-artifact://artifact-id';",
      });
      statement.status = {
        ...statement.status,
        phase: Phase.COMPLETED,
        traits: {
          sql_kind: "NOT A CREATE FUNCTION",
        },
      };
      const database = TEST_CCLOUD_KAFKA_CLUSTER as CCloudFlinkDbKafkaCluster;
      const stubbedEventEmitters = eventEmitterStubs(sandbox);
      const waitForStatementCompletionStub = sandbox.stub(
        statementUtils,
        "waitForStatementCompletion",
      );
      waitForStatementCompletionStub.resolves(statement);
      const stubbedUDFsChangedEmitter = stubbedEventEmitters.udfsChanged!;
      await fireEmitterWhenFlinkStatementIsCreatingFunction(statement, database);

      sinon.assert.notCalled(stubbedUDFsChangedEmitter.fire);
    });

    it("should not fire the emitter on a statement with a non-COMPLETED phase ", async () => {
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
      const database = TEST_CCLOUD_KAFKA_CLUSTER as CCloudFlinkDbKafkaCluster;
      const stubbedEventEmitters = eventEmitterStubs(sandbox);
      const waitForStatementCompletionStub = sandbox.stub(
        statementUtils,
        "waitForStatementCompletion",
      );
      waitForStatementCompletionStub.resolves(statement);
      const stubbedUDFsChangedEmitter = stubbedEventEmitters.udfsChanged!;
      await fireEmitterWhenFlinkStatementIsCreatingFunction(statement, database);

      sinon.assert.notCalled(stubbedUDFsChangedEmitter.fire);
    });
  });
});
