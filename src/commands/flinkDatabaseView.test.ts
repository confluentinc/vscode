import * as assert from "assert";
import * as sinon from "sinon";

import * as indexModule from ".";

import * as statementUtils from "../flinkSql/statementUtils";

import {
  createRelationFromFlinkDatabaseViewCommand,
  refreshResourceContainerCommand,
  registerFlinkDatabaseViewCommands,
} from "./flinkDatabaseView";

import { Uri, window, workspace } from "vscode";
import { getStubbedCCloudResourceLoader } from "../../tests/stubs/resourceLoaders";
import {
  TEST_CCLOUD_ENVIRONMENT,
  TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
} from "../../tests/unit/testResources";
import type { CCloudResourceLoader } from "../loaders";
import {
  FlinkDatabaseContainerLabel,
  FlinkDatabaseResourceContainer,
} from "../models/flinkDatabaseResourceContainer";
import { FlinkDatabaseViewProvider } from "../viewProviders/flinkDatabase";

describe("commands/flinkDatabaseView.ts", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("registerFlinkDatabaseViewCommands", () => {
    let registerCommandWithLoggingStub: sinon.SinonStub;

    beforeEach(() => {
      registerCommandWithLoggingStub = sandbox.stub(indexModule, "registerCommandWithLogging");
    });

    it("should register the expected commands", () => {
      registerFlinkDatabaseViewCommands();

      assert.strictEqual(registerCommandWithLoggingStub.callCount, 2);

      sinon.assert.calledWithExactly(
        registerCommandWithLoggingStub,
        "confluent.flinkdatabase.createRelation",
        createRelationFromFlinkDatabaseViewCommand,
      );
      sinon.assert.calledWithExactly(
        registerCommandWithLoggingStub,
        "confluent.flinkdatabase.refreshResourceContainer",
        refreshResourceContainerCommand,
      );
    });
  });

  describe("refreshResourceContainerCommand", () => {
    let provider: FlinkDatabaseViewProvider;
    let refreshRelationsStub: sinon.SinonStub;
    let refreshArtifactsStub: sinon.SinonStub;
    let refreshUDFsStub: sinon.SinonStub;
    let refreshAIConnectionsStub: sinon.SinonStub;
    let refreshAIToolsStub: sinon.SinonStub;
    let refreshAIModelsStub: sinon.SinonStub;
    let refreshAIAgentsStub: sinon.SinonStub;

    beforeEach(() => {
      provider = FlinkDatabaseViewProvider.getInstance();
      provider["resource"] = TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER;

      refreshRelationsStub = sandbox.stub(provider, "refreshRelationsContainer").resolves();
      refreshArtifactsStub = sandbox.stub(provider, "refreshArtifactsContainer").resolves();
      refreshUDFsStub = sandbox.stub(provider, "refreshUDFsContainer").resolves();
      refreshAIConnectionsStub = sandbox.stub(provider, "refreshAIConnectionsContainer").resolves();
      refreshAIToolsStub = sandbox.stub(provider, "refreshAIToolsContainer").resolves();
      refreshAIModelsStub = sandbox.stub(provider, "refreshAIModelsContainer").resolves();
      refreshAIAgentsStub = sandbox.stub(provider, "refreshAIAgentsContainer").resolves();
    });

    afterEach(() => {
      provider.dispose();
      FlinkDatabaseViewProvider["instanceMap"].clear();
    });

    it("should bail early if no container is provided", async () => {
      await refreshResourceContainerCommand(undefined as any);

      sinon.assert.notCalled(refreshRelationsStub);
      sinon.assert.notCalled(refreshArtifactsStub);
      sinon.assert.notCalled(refreshUDFsStub);
      sinon.assert.notCalled(refreshAIConnectionsStub);
      sinon.assert.notCalled(refreshAIToolsStub);
      sinon.assert.notCalled(refreshAIModelsStub);
      sinon.assert.notCalled(refreshAIAgentsStub);
    });

    it("should bail early if no database is selected", async () => {
      provider["resource"] = null;
      const container = new FlinkDatabaseResourceContainer(
        FlinkDatabaseContainerLabel.RELATIONS,
        [],
      );
      await refreshResourceContainerCommand(container);

      sinon.assert.notCalled(refreshRelationsStub);
      sinon.assert.notCalled(refreshArtifactsStub);
      sinon.assert.notCalled(refreshUDFsStub);
      sinon.assert.notCalled(refreshAIConnectionsStub);
      sinon.assert.notCalled(refreshAIToolsStub);
      sinon.assert.notCalled(refreshAIModelsStub);
      sinon.assert.notCalled(refreshAIAgentsStub);
    });

    it("should call refreshRelationsContainer when the Tables and Views container is provided", async () => {
      const container = new FlinkDatabaseResourceContainer(
        FlinkDatabaseContainerLabel.RELATIONS,
        [],
      );

      await refreshResourceContainerCommand(container);

      sinon.assert.calledOnceWithExactly(
        refreshRelationsStub,
        TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        true,
      );
      sinon.assert.notCalled(refreshArtifactsStub);
      sinon.assert.notCalled(refreshUDFsStub);
      sinon.assert.notCalled(refreshAIConnectionsStub);
      sinon.assert.notCalled(refreshAIToolsStub);
      sinon.assert.notCalled(refreshAIModelsStub);
      sinon.assert.notCalled(refreshAIAgentsStub);
    });

    it("should call refreshArtifactsContainer when the Artifacts container is provided", async () => {
      const container = new FlinkDatabaseResourceContainer(
        FlinkDatabaseContainerLabel.ARTIFACTS,
        [],
      );

      await refreshResourceContainerCommand(container);

      sinon.assert.notCalled(refreshRelationsStub);
      sinon.assert.calledOnceWithExactly(
        refreshArtifactsStub,
        TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        true,
      );
      sinon.assert.notCalled(refreshUDFsStub);
      sinon.assert.notCalled(refreshAIConnectionsStub);
      sinon.assert.notCalled(refreshAIToolsStub);
      sinon.assert.notCalled(refreshAIModelsStub);
      sinon.assert.notCalled(refreshAIAgentsStub);
    });

    it("should call refreshUDFsContainer when the UDFs container is provided", async () => {
      const container = new FlinkDatabaseResourceContainer(FlinkDatabaseContainerLabel.UDFS, []);

      await refreshResourceContainerCommand(container);

      sinon.assert.notCalled(refreshRelationsStub);
      sinon.assert.notCalled(refreshArtifactsStub);
      sinon.assert.calledOnceWithExactly(refreshUDFsStub, TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, true);
      sinon.assert.notCalled(refreshAIConnectionsStub);
      sinon.assert.notCalled(refreshAIToolsStub);
      sinon.assert.notCalled(refreshAIModelsStub);
      sinon.assert.notCalled(refreshAIAgentsStub);
    });

    it("should call refreshAIConnectionsContainer when the AI Connections container is provided", async () => {
      const container = new FlinkDatabaseResourceContainer(
        FlinkDatabaseContainerLabel.AI_CONNECTIONS,
        [],
      );

      await refreshResourceContainerCommand(container);

      sinon.assert.notCalled(refreshRelationsStub);
      sinon.assert.notCalled(refreshArtifactsStub);
      sinon.assert.notCalled(refreshUDFsStub);
      sinon.assert.calledOnceWithExactly(
        refreshAIConnectionsStub,
        TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        true,
      );
      sinon.assert.notCalled(refreshAIToolsStub);
      sinon.assert.notCalled(refreshAIModelsStub);
      sinon.assert.notCalled(refreshAIAgentsStub);
    });

    it("should call refreshAIToolsContainer when the AI Tools container is provided", async () => {
      const container = new FlinkDatabaseResourceContainer(
        FlinkDatabaseContainerLabel.AI_TOOLS,
        [],
      );

      await refreshResourceContainerCommand(container);

      sinon.assert.notCalled(refreshRelationsStub);
      sinon.assert.notCalled(refreshArtifactsStub);
      sinon.assert.notCalled(refreshUDFsStub);
      sinon.assert.notCalled(refreshAIConnectionsStub);
      sinon.assert.calledOnceWithExactly(
        refreshAIToolsStub,
        TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        true,
      );
      sinon.assert.notCalled(refreshAIModelsStub);
      sinon.assert.notCalled(refreshAIAgentsStub);
    });

    it("should call refreshAIModelsContainer when the AI Models container is provided", async () => {
      const container = new FlinkDatabaseResourceContainer(
        FlinkDatabaseContainerLabel.AI_MODELS,
        [],
      );

      await refreshResourceContainerCommand(container);

      sinon.assert.notCalled(refreshRelationsStub);
      sinon.assert.notCalled(refreshArtifactsStub);
      sinon.assert.notCalled(refreshUDFsStub);
      sinon.assert.notCalled(refreshAIConnectionsStub);
      sinon.assert.notCalled(refreshAIToolsStub);
      sinon.assert.calledOnceWithExactly(
        refreshAIModelsStub,
        TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        true,
      );
      sinon.assert.notCalled(refreshAIAgentsStub);
    });

    it("should call refreshAIAgentsContainer when the AI Agents container is provided", async () => {
      const container = new FlinkDatabaseResourceContainer(
        FlinkDatabaseContainerLabel.AI_AGENTS,
        [],
      );

      await refreshResourceContainerCommand(container);

      sinon.assert.notCalled(refreshRelationsStub);
      sinon.assert.notCalled(refreshArtifactsStub);
      sinon.assert.notCalled(refreshUDFsStub);
      sinon.assert.notCalled(refreshAIConnectionsStub);
      sinon.assert.notCalled(refreshAIToolsStub);
      sinon.assert.notCalled(refreshAIModelsStub);
      sinon.assert.calledOnceWithExactly(
        refreshAIAgentsStub,
        TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        true,
      );
    });
  });

  describe("createRelationFromFlinkDatabaseViewCommand", () => {
    let mockFlinkDatabaseViewProviderInstance: FlinkDatabaseViewProvider;
    let stubbedCloudResourceLoader: sinon.SinonStubbedInstance<CCloudResourceLoader>;
    let openTextDocumentStub: sinon.SinonStub;

    beforeEach(() => {
      mockFlinkDatabaseViewProviderInstance = new FlinkDatabaseViewProvider();

      sandbox
        .stub(FlinkDatabaseViewProvider, "getInstance")
        .returns(mockFlinkDatabaseViewProviderInstance);

      stubbedCloudResourceLoader = getStubbedCCloudResourceLoader(sandbox);

      openTextDocumentStub = sandbox.stub(workspace, "openTextDocument");
    });

    afterEach(() => {
      mockFlinkDatabaseViewProviderInstance.dispose();
      FlinkDatabaseViewProvider["instanceMap"].clear();
    });

    it("bails early if no Flink database is selected", async () => {
      // Mock no selected Flink database
      sandbox.stub(mockFlinkDatabaseViewProviderInstance, "database").get(() => undefined);

      await createRelationFromFlinkDatabaseViewCommand();

      // should not attempt to get environment from resource loader.
      sinon.assert.notCalled(stubbedCloudResourceLoader.getEnvironment);
    });

    it("bails early if somehow unable to find the environment for the selected Flink database", async () => {
      // Mock selected Flink database
      sandbox
        .stub(mockFlinkDatabaseViewProviderInstance, "database")
        .get(() => TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER);

      // Mock resource loader to return undefined environment
      stubbedCloudResourceLoader.getEnvironment.resolves(undefined);

      await createRelationFromFlinkDatabaseViewCommand();

      sinon.assert.calledOnceWithExactly(
        stubbedCloudResourceLoader.getEnvironment,
        TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.environmentId,
      );

      // does not progress on to openTextDocument
      sinon.assert.notCalled(openTextDocumentStub);
    });

    it("opens a new Flink SQL document with the expected template content", async () => {
      // Mock selected Flink database
      sandbox
        .stub(mockFlinkDatabaseViewProviderInstance, "database")
        .get(() => TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER);

      stubbedCloudResourceLoader.getEnvironment.resolves(TEST_CCLOUD_ENVIRONMENT);

      const newDocumentUri = Uri.parse("untitled://Untitled-1");
      const mockDocument: any = { uri: newDocumentUri, lineCount: 10 };
      openTextDocumentStub.resolves(mockDocument);

      const mockEditor: any = { selection: undefined };

      const showTextDocumentStub = sandbox.stub(window, "showTextDocument").resolves(mockEditor);

      const setFlinkDocumentMetadataStub = sandbox
        .stub(statementUtils, "setFlinkDocumentMetadata")
        .resolves();

      await createRelationFromFlinkDatabaseViewCommand();

      sinon.assert.calledOnceWithExactly(
        stubbedCloudResourceLoader.getEnvironment,
        TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.environmentId,
      );

      sinon.assert.calledOnceWithExactly(openTextDocumentStub, {
        language: "flinksql",
        content: sinon.match((value: string) =>
          value.includes("Write your CREATE TABLE or CREATE VIEW"),
        ),
      });

      sinon.assert.calledOnceWithExactly(setFlinkDocumentMetadataStub, newDocumentUri, {
        catalog: TEST_CCLOUD_ENVIRONMENT,
        database: TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        computePool: TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.flinkPools[0],
      });

      sinon.assert.calledOnceWithExactly(showTextDocumentStub, mockDocument);

      // the editor selection should be set to a Selection instance at the end of the document

      assert.strictEqual(
        mockEditor.selection.start.line,
        mockDocument.lineCount - 1, // -1 'cause is 0 based line count
        mockEditor.selection.start.line,
      );
      assert.strictEqual(mockEditor.selection.start.character, 0);
    });
  });
});
