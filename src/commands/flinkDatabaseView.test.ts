import * as assert from "assert";
import * as sinon from "sinon";

import * as indexModule from ".";

import * as statementUtils from "../flinkSql/statementUtils";

import {
  createRelationFromFlinkDatabaseViewCommand,
  queryFlinkRelationCommand,
  refreshResourceContainerCommand,
  registerFlinkDatabaseViewCommands,
} from "./flinkDatabaseView";

import { Uri, window, workspace } from "vscode";
import { getStubbedCCloudResourceLoader } from "../../tests/stubs/resourceLoaders";
import {
  TEST_CCLOUD_ENVIRONMENT,
  TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
  TEST_FLINK_RELATION,
  TEST_FLINK_VIEW,
} from "../../tests/unit/testResources";
import type { CCloudResourceLoader } from "../loaders";
import {
  FlinkDatabaseContainerLabel,
  FlinkDatabaseResourceContainer,
} from "../models/containers/flinkDatabaseResourceContainer";
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

      assert.strictEqual(registerCommandWithLoggingStub.callCount, 3);

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
      sinon.assert.calledWithExactly(
        registerCommandWithLoggingStub,
        "confluent.flinkdatabase.queryRelation",
        queryFlinkRelationCommand,
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

  describe("queryFlinkRelationCommand", () => {
    let stubbedCloudResourceLoader: sinon.SinonStubbedInstance<CCloudResourceLoader>;
    let openTextDocumentStub: sinon.SinonStub;
    let showTextDocumentStub: sinon.SinonStub;
    let setFlinkDocumentMetadataStub: sinon.SinonStub;

    beforeEach(() => {
      stubbedCloudResourceLoader = getStubbedCCloudResourceLoader(sandbox);
      openTextDocumentStub = sandbox.stub(workspace, "openTextDocument");
      showTextDocumentStub = sandbox.stub(window, "showTextDocument");
      setFlinkDocumentMetadataStub = sandbox
        .stub(statementUtils, "setFlinkDocumentMetadata")
        .resolves();
    });

    describe("error handling", () => {
      it("should throw error when no relation is provided", async () => {
        await assert.rejects(
          async () => await queryFlinkRelationCommand(undefined as any),
          /no relation was provided/,
        );

        sinon.assert.notCalled(stubbedCloudResourceLoader.getEnvironment);
        sinon.assert.notCalled(stubbedCloudResourceLoader.getFlinkDatabase);
        sinon.assert.notCalled(openTextDocumentStub);
        sinon.assert.notCalled(showTextDocumentStub);
      });

      it("should throw error when environment is not found", async () => {
        stubbedCloudResourceLoader.getEnvironment.resolves(undefined);

        await assert.rejects(
          async () => await queryFlinkRelationCommand(TEST_FLINK_RELATION),
          /environment.*could not be found/,
        );

        sinon.assert.calledOnceWithExactly(
          stubbedCloudResourceLoader.getEnvironment,
          TEST_FLINK_RELATION.environmentId,
        );
        sinon.assert.notCalled(stubbedCloudResourceLoader.getFlinkDatabase);
        sinon.assert.notCalled(openTextDocumentStub);
        sinon.assert.notCalled(showTextDocumentStub);
      });

      it("should throw error when Flink database is not found", async () => {
        stubbedCloudResourceLoader.getEnvironment.resolves(TEST_CCLOUD_ENVIRONMENT);
        stubbedCloudResourceLoader.getFlinkDatabase.resolves(undefined);

        await assert.rejects(
          async () => await queryFlinkRelationCommand(TEST_FLINK_RELATION),
          /database.*is not available/,
        );

        sinon.assert.calledOnceWithExactly(
          stubbedCloudResourceLoader.getEnvironment,
          TEST_FLINK_RELATION.environmentId,
        );
        sinon.assert.calledOnceWithExactly(
          stubbedCloudResourceLoader.getFlinkDatabase,
          TEST_FLINK_RELATION.environmentId,
          TEST_FLINK_RELATION.databaseId,
        );
        sinon.assert.notCalled(openTextDocumentStub);
        sinon.assert.notCalled(showTextDocumentStub);
      });

      it("should throw error when no compute pool is available", async () => {
        stubbedCloudResourceLoader.getEnvironment.resolves(TEST_CCLOUD_ENVIRONMENT);
        const databaseWithoutPools = {
          ...TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
          flinkPools: [],
        } as any;
        stubbedCloudResourceLoader.getFlinkDatabase.resolves(databaseWithoutPools);

        await assert.rejects(
          async () => await queryFlinkRelationCommand(TEST_FLINK_RELATION),
          /no compute pool is configured/,
        );

        sinon.assert.calledOnceWithExactly(
          stubbedCloudResourceLoader.getEnvironment,
          TEST_FLINK_RELATION.environmentId,
        );
        sinon.assert.calledOnceWithExactly(
          stubbedCloudResourceLoader.getFlinkDatabase,
          TEST_FLINK_RELATION.environmentId,
          TEST_FLINK_RELATION.databaseId,
        );
        sinon.assert.notCalled(openTextDocumentStub);
        sinon.assert.notCalled(showTextDocumentStub);
      });
    });

    describe("success cases", () => {
      let mockDocument: any;
      let mockEditor: any;

      beforeEach(() => {
        const newDocumentUri = Uri.parse("untitled://Untitled-1");
        mockDocument = {
          uri: newDocumentUri,
          positionAt: (offset: number) => ({ line: 0, character: offset }),
        };
        mockEditor = { selection: undefined };

        stubbedCloudResourceLoader.getEnvironment.resolves(TEST_CCLOUD_ENVIRONMENT);
        stubbedCloudResourceLoader.getFlinkDatabase.resolves(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER);
        openTextDocumentStub.resolves(mockDocument);
        showTextDocumentStub.resolves(mockEditor);
      });

      it("should open FlinkSQL document with correct query template for base table", async () => {
        await queryFlinkRelationCommand(TEST_FLINK_RELATION);

        // Verify environment lookup
        sinon.assert.calledOnceWithExactly(
          stubbedCloudResourceLoader.getEnvironment,
          TEST_FLINK_RELATION.environmentId,
        );

        // Verify database lookup
        sinon.assert.calledOnceWithExactly(
          stubbedCloudResourceLoader.getFlinkDatabase,
          TEST_FLINK_RELATION.environmentId,
          TEST_FLINK_RELATION.databaseId,
        );

        // Verify document creation with correct template
        sinon.assert.calledOnceWithExactly(openTextDocumentStub, {
          language: "flinksql",
          content: "SELECT * FROM `test_relation` LIMIT 10;\n",
        });

        // Verify document metadata
        sinon.assert.calledOnceWithExactly(setFlinkDocumentMetadataStub, mockDocument.uri, {
          catalog: TEST_CCLOUD_ENVIRONMENT,
          database: TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
          computePool: TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.flinkPools[0],
        });

        // Verify document is shown
        sinon.assert.calledOnceWithExactly(showTextDocumentStub, mockDocument);

        // Verify cursor is positioned at end of content
        assert.ok(mockEditor.selection);
        assert.strictEqual(mockEditor.selection.start.line, 0);
        assert.strictEqual(
          mockEditor.selection.start.character,
          "SELECT * FROM `test_relation` LIMIT 10;\n".length,
        );
      });

      it("should open FlinkSQL document with correct query template for view", async () => {
        await queryFlinkRelationCommand(TEST_FLINK_VIEW);

        // Verify document creation uses view name
        sinon.assert.calledOnceWithExactly(openTextDocumentStub, {
          language: "flinksql",
          content: "SELECT * FROM `test_view` LIMIT 10;\n",
        });

        // Verify all other steps are the same
        sinon.assert.calledOnce(stubbedCloudResourceLoader.getEnvironment);
        sinon.assert.calledOnce(stubbedCloudResourceLoader.getFlinkDatabase);
        sinon.assert.calledOnce(setFlinkDocumentMetadataStub);
        sinon.assert.calledOnce(showTextDocumentStub);
      });

      it("should escape table name with backticks in query template", async () => {
        await queryFlinkRelationCommand(TEST_FLINK_RELATION);

        const callArgs = openTextDocumentStub.getCall(0).args[0];
        assert.ok(callArgs.content.includes("`test_relation`"));
        assert.ok(callArgs.content.startsWith("SELECT * FROM `"));
      });
    });
  });
});
