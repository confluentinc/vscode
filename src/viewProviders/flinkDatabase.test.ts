import * as assert from "assert";
import * as sinon from "sinon";
import type { CancellationToken, Progress } from "vscode";
import { window } from "vscode";
import { getStubbedCCloudResourceLoader } from "../../tests/stubs/resourceLoaders";
import { TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER } from "../../tests/unit/testResources";
import { createFlinkAIAgent } from "../../tests/unit/testResources/flinkAIAgent";
import { createFlinkAIConnection } from "../../tests/unit/testResources/flinkAIConnection";
import { createFlinkAIModel } from "../../tests/unit/testResources/flinkAIModel";
import { createFlinkAITool } from "../../tests/unit/testResources/flinkAITool";
import { createFlinkArtifact } from "../../tests/unit/testResources/flinkArtifact";
import { createFakeFlinkDatabaseResource } from "../../tests/unit/testResources/flinkDatabaseResource";
import {
  TEST_FLINK_RELATION,
  TEST_VARCHAR_COLUMN,
} from "../../tests/unit/testResources/flinkRelation";
import { createFlinkUDF } from "../../tests/unit/testResources/flinkUDF";
import { TEST_CCLOUD_KAFKA_CLUSTER } from "../../tests/unit/testResources/kafkaCluster";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import { ResponseError } from "../clients/flinkArtifacts";
import type { EventChangeType } from "../emitters";
import type { CCloudResourceLoader } from "../loaders";
import { FlinkAIAgentTreeItem } from "../models/flinkAiAgent";
import { FlinkAIConnectionTreeItem } from "../models/flinkAiConnection";
import { FlinkAIModelTreeItem } from "../models/flinkAiModel";
import { FlinkAIToolTreeItem } from "../models/flinkAiTool";
import { FlinkArtifactTreeItem } from "../models/flinkArtifact";
import type { FlinkDatabaseResource } from "../models/flinkDatabaseResource";
import {
  FlinkDatabaseContainerLabel,
  FlinkDatabaseResourceContainer,
} from "../models/flinkDatabaseResourceContainer";
import { FlinkUdfTreeItem } from "../models/flinkUDF";
import type { CCloudFlinkDbKafkaCluster } from "../models/kafkaCluster";
import { CCloudKafkaCluster } from "../models/kafkaCluster";
import type { CustomMarkdownString } from "../models/main";
import type { EnvironmentId, IEnvProviderRegion } from "../models/resource";
import { FlinkDatabaseViewProvider } from "./flinkDatabase";

describe("viewProviders/flinkDatabase.ts", () => {
  let sandbox: sinon.SinonSandbox;

  before(async () => {
    await getTestExtensionContext();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("FlinkDatabaseViewProvider", () => {
    let viewProvider: FlinkDatabaseViewProvider;
    let ccloudLoader: sinon.SinonStubbedInstance<CCloudResourceLoader>;
    let onDidChangeTreeDataFireStub: sinon.SinonStub;

    beforeEach(async () => {
      viewProvider = FlinkDatabaseViewProvider.getInstance();
      // focused on a Flink database by default
      viewProvider["resource"] = TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER;

      onDidChangeTreeDataFireStub = sandbox.stub(viewProvider["_onDidChangeTreeData"], "fire");

      ccloudLoader = getStubbedCCloudResourceLoader(sandbox);
      // no resources returned by default
      ccloudLoader.getFlinkRelations.resolves([]);
      ccloudLoader.getFlinkArtifacts.resolves([]);
      ccloudLoader.getFlinkUDFs.resolves([]);
      ccloudLoader.getFlinkAIConnections.resolves([]);
      ccloudLoader.getFlinkAITools.resolves([]);
      ccloudLoader.getFlinkAIModels.resolves([]);
      ccloudLoader.getFlinkAIAgents.resolves([]);
    });

    afterEach(() => {
      viewProvider.dispose();
      // reset singleton instances between tests
      FlinkDatabaseViewProvider["instanceMap"].clear();
    });

    describe("getChildren()", () => {
      let filterChildrenStub: sinon.SinonStub;

      beforeEach(() => {
        filterChildrenStub = sandbox.stub(viewProvider, "filterChildren");
      });

      it("should return an empty array when no database is set", () => {
        viewProvider["resource"] = null;

        const children = viewProvider.getChildren();

        assert.deepStrictEqual(children, []);
        sinon.assert.notCalled(filterChildrenStub);
      });

      it("should return container items when a database is set", () => {
        viewProvider["resource"] = TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER;
        const testContainers = [
          viewProvider.relationsContainer,
          viewProvider.artifactsContainer,
          viewProvider.udfsContainer,
          viewProvider.aiConnectionsContainer,
          viewProvider.aiToolsContainer,
          viewProvider.aiModelsContainer,
          viewProvider.aiAgentsContainer,
        ];
        filterChildrenStub.returns(testContainers);

        const children = viewProvider.getChildren();

        assert.strictEqual(children.length, 7);
        // all top-level containers, no actual resource instances at the root level
        const containers = children as FlinkDatabaseResourceContainer<FlinkDatabaseResource>[];
        for (const container of containers) {
          assert.ok(container instanceof FlinkDatabaseResourceContainer);
        }
        assert.strictEqual(containers[0].label, FlinkDatabaseContainerLabel.RELATIONS);
        assert.strictEqual(containers[1].label, FlinkDatabaseContainerLabel.ARTIFACTS);
        assert.strictEqual(containers[2].label, FlinkDatabaseContainerLabel.UDFS);
        assert.strictEqual(containers[3].label, FlinkDatabaseContainerLabel.AI_CONNECTIONS);
        assert.strictEqual(containers[4].label, FlinkDatabaseContainerLabel.AI_TOOLS);
        assert.strictEqual(containers[5].label, FlinkDatabaseContainerLabel.AI_MODELS);
        assert.strictEqual(containers[6].label, FlinkDatabaseContainerLabel.AI_AGENTS);
        sinon.assert.calledOnceWithExactly(filterChildrenStub, undefined, testContainers);
      });

      it("should return container children when expanding a container", () => {
        viewProvider["resource"] = TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER;
        const testRelations = [TEST_FLINK_RELATION];
        filterChildrenStub.returns(testRelations);
        const testContainer = new FlinkDatabaseResourceContainer(
          FlinkDatabaseContainerLabel.RELATIONS,
          testRelations,
        );

        const children = viewProvider.getChildren(testContainer);

        assert.deepStrictEqual(children, testRelations);
        sinon.assert.calledOnceWithExactly(filterChildrenStub, testContainer, children);
      });

      it("should return relation columns when expanding a relation", () => {
        viewProvider["resource"] = TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER;
        const testColumns = TEST_FLINK_RELATION.columns;
        filterChildrenStub.returns(testColumns);

        const children = viewProvider.getChildren(TEST_FLINK_RELATION);

        assert.deepStrictEqual(children, testColumns);
        sinon.assert.calledOnceWithExactly(filterChildrenStub, TEST_FLINK_RELATION, children);
      });
    });

    describe("getTreeItem()", () => {
      let adjustTreeItemForSearchStub: sinon.SinonStub;

      beforeEach(() => {
        adjustTreeItemForSearchStub = sandbox.stub(viewProvider, "adjustTreeItemForSearch");
      });

      it("should return a FlinkDatabaseResourceContainer directly", () => {
        const testContainer = new FlinkDatabaseResourceContainer(
          FlinkDatabaseContainerLabel.RELATIONS,
          [],
        );
        const treeItem = viewProvider.getTreeItem(testContainer);

        assert.strictEqual(treeItem, testContainer);
        sinon.assert.calledOnceWithExactly(adjustTreeItemForSearchStub, testContainer, treeItem);
      });

      it("should return a TreeItem from FlinkRelation.getTreeItem()", () => {
        const testRelation = TEST_FLINK_RELATION;
        const treeItem = viewProvider.getTreeItem(TEST_FLINK_RELATION);

        // can't assert instance of TreeItem since it's just an interface
        assert.strictEqual(treeItem.label, testRelation.name);
        sinon.assert.calledOnceWithExactly(adjustTreeItemForSearchStub, testRelation, treeItem);
      });

      it("should return a TreeItem from FlinkRelationColumn.getTreeItem()", () => {
        const testColumn = TEST_VARCHAR_COLUMN;
        const treeItem = viewProvider.getTreeItem(testColumn);

        // can't assert instance of TreeItem since it's just an interface
        assert.strictEqual(treeItem.label, testColumn.name);
        sinon.assert.calledOnceWithExactly(adjustTreeItemForSearchStub, testColumn, treeItem);
      });

      it("should return a FlinkArtifactTreeItem from a FlinkArtifact", () => {
        const testArtifact = createFlinkArtifact({ id: "art1", name: "TestArtifact" });
        const treeItem = viewProvider.getTreeItem(testArtifact);

        assert.ok(treeItem instanceof FlinkArtifactTreeItem);
        sinon.assert.calledOnceWithExactly(adjustTreeItemForSearchStub, testArtifact, treeItem);
      });

      it("should return a FlinkUdfTreeItem from a FlinkUdf", () => {
        const testUdf = createFlinkUDF("TestUDF");
        const treeItem = viewProvider.getTreeItem(testUdf);

        assert.ok(treeItem instanceof FlinkUdfTreeItem);
        sinon.assert.calledOnceWithExactly(adjustTreeItemForSearchStub, testUdf, treeItem);
      });

      it("should return a FlinkAIConnectionTreeItem from a FlinkAIConnection", () => {
        const testConnection = createFlinkAIConnection("TestConnection");
        const treeItem = viewProvider.getTreeItem(testConnection);

        assert.ok(treeItem instanceof FlinkAIConnectionTreeItem);
        sinon.assert.calledOnceWithExactly(adjustTreeItemForSearchStub, testConnection, treeItem);
      });

      it("should return a FlinkAIModelTreeItem from a FlinkAIModel", () => {
        const testModel = createFlinkAIModel("TestModel");
        const treeItem = viewProvider.getTreeItem(testModel);

        assert.ok(treeItem instanceof FlinkAIModelTreeItem);
        sinon.assert.calledOnceWithExactly(adjustTreeItemForSearchStub, testModel, treeItem);
      });

      it("should return a FlinkAIToolTreeItem from a FlinkAITool", () => {
        const testTool = createFlinkAITool("TestTool");
        const treeItem = viewProvider.getTreeItem(testTool);

        assert.ok(treeItem instanceof FlinkAIToolTreeItem);
        sinon.assert.calledOnceWithExactly(adjustTreeItemForSearchStub, testTool, treeItem);
      });

      it("returns FlinkAIAgentTreeItem from FlinkAIAgent", () => {
        const testAgent = createFlinkAIAgent("TestAgent");
        const treeItem = viewProvider.getTreeItem(testAgent);

        assert.ok(treeItem instanceof FlinkAIAgentTreeItem);
        sinon.assert.calledOnceWithExactly(adjustTreeItemForSearchStub, testAgent, treeItem);
      });
    });

    describe("getParent()", () => {
      it("should return undefined for FlinkDatabaseResourceContainers (root-level items)", () => {
        const testContainer = new FlinkDatabaseResourceContainer(
          FlinkDatabaseContainerLabel.RELATIONS,
          [],
        );

        const parent = viewProvider.getParent(testContainer);

        assert.strictEqual(parent, undefined);
      });

      it("should return the FlinkRelation parent for a FlinkRelationColumn", () => {
        const testRelation = TEST_FLINK_RELATION;
        const testColumn = TEST_VARCHAR_COLUMN;
        viewProvider.relationsContainer.children = [testRelation];

        const parent = viewProvider.getParent(testColumn);

        assert.strictEqual(parent, testRelation);
      });

      it("should return undefined when a FlinkRelationColumn parent is not found", () => {
        const testColumn = TEST_VARCHAR_COLUMN;
        viewProvider.relationsContainer.children = [];

        const parent = viewProvider.getParent(testColumn);

        assert.strictEqual(parent, undefined);
      });

      it("should return the relations container for a FlinkRelation", () => {
        const testRelation = TEST_FLINK_RELATION;

        const parent = viewProvider.getParent(testRelation);

        assert.strictEqual(parent, viewProvider.relationsContainer);
      });

      it("should return the artifacts container for a FlinkArtifact", () => {
        const testArtifact = createFlinkArtifact({ id: "art1", name: "TestArtifact" });

        const parent = viewProvider.getParent(testArtifact);

        assert.strictEqual(parent, viewProvider.artifactsContainer);
      });

      it("should return the UDFs container for a FlinkUdf", () => {
        const testUdf = createFlinkUDF("TestUDF");

        const parent = viewProvider.getParent(testUdf);

        assert.strictEqual(parent, viewProvider.udfsContainer);
      });

      it("should return the AI connections container for a FlinkAIConnection", () => {
        const testConnection = createFlinkAIConnection("TestConnection");

        const parent = viewProvider.getParent(testConnection);

        assert.strictEqual(parent, viewProvider.aiConnectionsContainer);
      });

      it("should return the AI tools container for a FlinkAITool", () => {
        const testTool = createFlinkAITool("TestTool");

        const parent = viewProvider.getParent(testTool);

        assert.strictEqual(parent, viewProvider.aiToolsContainer);
      });

      it("should return the AI models container for a FlinkAIModel", () => {
        const testModel = createFlinkAIModel("TestModel");

        const parent = viewProvider.getParent(testModel);

        assert.strictEqual(parent, viewProvider.aiModelsContainer);
      });

      it("should return the AI agents container for a FlinkAIAgent", () => {
        const testAgent = createFlinkAIAgent("TestAgent");

        const parent = viewProvider.getParent(testAgent);

        assert.strictEqual(parent, viewProvider.aiAgentsContainer);
      });
    });

    describe("revealResource()", () => {
      let treeViewRevealStub: sinon.SinonStub;
      const defaultOptions = { select: true, focus: true, expand: false };

      beforeEach(() => {
        treeViewRevealStub = sandbox.stub(viewProvider["treeView"], "reveal").resolves();
      });

      it("should do nothing when no database is selected", async () => {
        viewProvider["resource"] = null;
        const testArtifact = createFlinkArtifact({ id: "art1", name: "TestArtifact" });

        await viewProvider.revealResource(testArtifact);

        sinon.assert.notCalled(treeViewRevealStub);
      });

      it("should reveal a FlinkDatabaseResourceContainer directly", async () => {
        const testContainer = viewProvider.artifactsContainer;

        await viewProvider.revealResource(testContainer);

        sinon.assert.calledOnce(treeViewRevealStub);
        sinon.assert.calledOnceWithExactly(treeViewRevealStub, testContainer, defaultOptions);
      });

      it("should reveal a FlinkArtifact by finding it in the artifacts container", async () => {
        const testArtifact = createFlinkArtifact({ id: "art1", name: "TestArtifact" });
        viewProvider.artifactsContainer.children = [testArtifact];

        await viewProvider.revealResource(testArtifact);

        sinon.assert.calledOnce(treeViewRevealStub);
        sinon.assert.calledOnceWithExactly(treeViewRevealStub, testArtifact, defaultOptions);
      });

      it("should reveal a FlinkUdf by finding it in the UDFs container", async () => {
        const testUdf = createFlinkUDF("TestUDF");
        viewProvider.udfsContainer.children = [testUdf];

        await viewProvider.revealResource(testUdf);

        sinon.assert.calledOnce(treeViewRevealStub);
        sinon.assert.calledOnceWithExactly(treeViewRevealStub, testUdf, defaultOptions);
      });

      it("should reveal a FlinkRelation by finding it in the relations container", async () => {
        const testRelation = TEST_FLINK_RELATION;
        viewProvider.relationsContainer.children = [testRelation];

        await viewProvider.revealResource(testRelation);

        sinon.assert.calledOnce(treeViewRevealStub);
        sinon.assert.calledOnceWithExactly(treeViewRevealStub, testRelation, defaultOptions);
      });

      it("should reveal a FlinkRelationColumn by finding its parent relation", async () => {
        const testRelation = TEST_FLINK_RELATION;
        const testColumn = TEST_VARCHAR_COLUMN;
        viewProvider.relationsContainer.children = [testRelation];

        await viewProvider.revealResource(testColumn);

        // should reveal the parent relation, not the column directly
        sinon.assert.calledOnce(treeViewRevealStub);
        sinon.assert.calledOnceWithExactly(treeViewRevealStub, testRelation, defaultOptions);
      });

      it("should reveal a FlinkAIConnection by finding it in the AI connections container", async () => {
        const testConnection = createFlinkAIConnection("TestConnection");
        viewProvider.aiConnectionsContainer.children = [testConnection];

        await viewProvider.revealResource(testConnection);

        sinon.assert.calledOnce(treeViewRevealStub);
        sinon.assert.calledOnceWithExactly(treeViewRevealStub, testConnection, defaultOptions);
      });

      it("should reveal a FlinkAITool by finding it in the AI tools container", async () => {
        const testTool = createFlinkAITool("TestTool");
        viewProvider.aiToolsContainer.children = [testTool];

        await viewProvider.revealResource(testTool);

        sinon.assert.calledOnce(treeViewRevealStub);
        sinon.assert.calledOnceWithExactly(treeViewRevealStub, testTool, defaultOptions);
      });

      it("should reveal a FlinkAIModel by finding it in the AI models container", async () => {
        const testModel = createFlinkAIModel("TestModel");
        viewProvider.aiModelsContainer.children = [testModel];

        await viewProvider.revealResource(testModel);

        sinon.assert.calledOnce(treeViewRevealStub);
        sinon.assert.calledOnceWithExactly(treeViewRevealStub, testModel, defaultOptions);
      });

      it("should reveal a FlinkAIAgent by finding it in the AI agents container", async () => {
        const testAgent = createFlinkAIAgent("TestAgent");
        viewProvider.aiAgentsContainer.children = [testAgent];

        await viewProvider.revealResource(testAgent);

        sinon.assert.calledOnce(treeViewRevealStub);
        sinon.assert.calledOnceWithExactly(treeViewRevealStub, testAgent, defaultOptions);
      });

      it("should not call reveal when resource is not found in containers", async () => {
        const testArtifact = createFlinkArtifact({
          id: "nope-this-belongs-somewhere-else",
          name: "TestArtifact",
        });
        viewProvider.artifactsContainer.children = [];

        await viewProvider.revealResource(testArtifact);

        sinon.assert.notCalled(treeViewRevealStub);
      });

      it("should use custom options when provided", async () => {
        const testArtifact = createFlinkArtifact({ id: "art1", name: "TestArtifact" });
        viewProvider.artifactsContainer.children = [testArtifact];

        const customOptions = {
          select: false,
          focus: false,
          expand: 2,
        };
        await viewProvider.revealResource(testArtifact, customOptions);

        sinon.assert.calledOnce(treeViewRevealStub);
        sinon.assert.calledOnceWithExactly(treeViewRevealStub, testArtifact, customOptions);
      });

      it("should handle treeView.reveal errors gracefully", async () => {
        const testArtifact = createFlinkArtifact({ id: "art1", name: "TestArtifact" });
        viewProvider.artifactsContainer.children = [testArtifact];
        const error = new Error("TreeView reveal failed");
        treeViewRevealStub.rejects(error);

        // should not throw
        await viewProvider.revealResource(testArtifact);

        sinon.assert.calledOnce(treeViewRevealStub);
      });
    });

    describe("refresh()", () => {
      let withProgressStub: sinon.SinonStub;

      beforeEach(() => {
        withProgressStub = sandbox.stub(window, "withProgress").callsFake((_, callback) => {
          const mockProgress = {} as Progress<unknown>;
          const mockToken = {} as CancellationToken;
          return Promise.resolve(callback(mockProgress, mockToken));
        });
      });

      it("should fire onDidChangeTreeData when no database is selected", async () => {
        viewProvider["resource"] = null;

        await viewProvider.refresh();

        sinon.assert.calledOnce(onDidChangeTreeDataFireStub);
        sinon.assert.notCalled(withProgressStub);
      });

      it("should refresh all containers when a database is selected", async () => {
        // focused on a database by default
        await viewProvider.refresh();

        sinon.assert.calledOnce(withProgressStub);
        sinon.assert.calledOnce(ccloudLoader.getFlinkRelations);
        sinon.assert.calledOnce(ccloudLoader.getFlinkArtifacts);
        sinon.assert.calledOnce(ccloudLoader.getFlinkUDFs);
        sinon.assert.calledOnce(ccloudLoader.getFlinkAIConnections);
        sinon.assert.calledOnce(ccloudLoader.getFlinkAITools);
        sinon.assert.calledOnce(ccloudLoader.getFlinkAIModels);
        sinon.assert.calledOnce(ccloudLoader.getFlinkAIAgents);
      });

      for (const forceDeepRefresh of [true, false]) {
        it(`should pass forceDeepRefresh:${forceDeepRefresh} to all loader methods`, async () => {
          await viewProvider.refresh(forceDeepRefresh);

          sinon.assert.calledWith(
            ccloudLoader.getFlinkRelations,
            TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
            forceDeepRefresh,
          );
          sinon.assert.calledWith(
            ccloudLoader.getFlinkArtifacts,
            TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
            forceDeepRefresh,
          );
          sinon.assert.calledWith(
            ccloudLoader.getFlinkUDFs,
            TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
            forceDeepRefresh,
          );
          sinon.assert.calledWith(
            ccloudLoader.getFlinkAIConnections,
            TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
            forceDeepRefresh,
          );
          sinon.assert.calledWith(
            ccloudLoader.getFlinkAITools,
            TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
            forceDeepRefresh,
          );
          sinon.assert.calledWith(
            ccloudLoader.getFlinkAIModels,
            TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
            forceDeepRefresh,
          );
          sinon.assert.calledWith(
            ccloudLoader.getFlinkAIAgents,
            TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
            forceDeepRefresh,
          );
        });
      }
    });

    describe("refreshResourceContainer()", () => {
      // fake resource, container, and loader method not associated with any given resource type
      const testResources = [createFakeFlinkDatabaseResource()];
      const testContainer = new FlinkDatabaseResourceContainer(
        "TEST" as FlinkDatabaseContainerLabel,
        [],
      );
      let testLoaderMethodStub: sinon.SinonStub;

      beforeEach(() => {
        testLoaderMethodStub = sandbox.stub().resolves(testResources);
      });

      it("should refresh the container item before and after the call to the provided loader method", async () => {
        await viewProvider["refreshResourceContainer"](
          TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
          testContainer,
          testLoaderMethodStub,
          false,
        );

        sinon.assert.calledOnce(testLoaderMethodStub);
        // one update for loading state, one for resolved resources
        sinon.assert.callCount(onDidChangeTreeDataFireStub, 2);
        sinon.assert.calledWithExactly(onDidChangeTreeDataFireStub, testContainer);
        sinon.assert.callOrder(
          onDidChangeTreeDataFireStub,
          testLoaderMethodStub,
          onDidChangeTreeDataFireStub,
        );
      });

      it("should update the resource container's children with results when loader method completes successfully", async () => {
        await viewProvider["refreshResourceContainer"](
          TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
          testContainer,
          testLoaderMethodStub,
          false,
        );

        assert.strictEqual(testContainer.children.length, testResources.length);
        assert.strictEqual(testContainer.hasError, false);
        assert.strictEqual(testContainer.isLoading, false);
      });

      it("should set the container's hasError to true when the loader call fails", async () => {
        const error = new ResponseError(new Response("Server error", { status: 500 }));
        testLoaderMethodStub.rejects(error);

        await viewProvider["refreshResourceContainer"](
          TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
          testContainer,
          testLoaderMethodStub,
          false,
        );

        assert.strictEqual(testContainer.children.length, 0);
        assert.strictEqual(testContainer.hasError, true);
        assert.ok(testContainer.tooltip);
      });

      it("should update the container's tooltip for ResponseError errors", async () => {
        const error = new ResponseError(new Response("Server error", { status: 500 }));
        testLoaderMethodStub.rejects(error);

        await viewProvider["refreshResourceContainer"](
          TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
          testContainer,
          testLoaderMethodStub,
          false,
        );

        assert.strictEqual(testContainer.children.length, 0);
        assert.strictEqual(testContainer.hasError, true);
        assert.ok(testContainer.tooltip);
        assert.ok((testContainer.tooltip as CustomMarkdownString).value.includes("Server error"));
      });

      it("should update the container's tooltip for non-ResponseError errors", async () => {
        const error = new Error("Network connection failed");
        testLoaderMethodStub.rejects(error);

        await viewProvider["refreshResourceContainer"](
          TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
          testContainer,
          testLoaderMethodStub,
          false,
        );

        assert.strictEqual(testContainer.children.length, 0);
        assert.strictEqual(testContainer.hasError, true);
        assert.ok(testContainer.tooltip);
        assert.ok((testContainer.tooltip as CustomMarkdownString).value.includes(error.message));
      });

      for (const forceDeepRefresh of [true, false]) {
        it(`should pass the database and forceDeepRefresh=${forceDeepRefresh} to the provided loader method`, async () => {
          testLoaderMethodStub.resolves([]);

          await viewProvider["refreshResourceContainer"](
            TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
            testContainer,
            testLoaderMethodStub,
            forceDeepRefresh,
          );

          sinon.assert.calledOnceWithExactly(
            testLoaderMethodStub,
            TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
            forceDeepRefresh,
          );
        });
      }
    });

    describe("refreshResourceContainer wrappers", () => {
      let refreshResourceContainerStub: sinon.SinonStub;

      beforeEach(() => {
        refreshResourceContainerStub = sandbox.stub();
        viewProvider["refreshResourceContainer"] = refreshResourceContainerStub;
      });

      for (const forceDeepRefresh of [true, false]) {
        it(`refreshArtifactsContainer() should update the artifacts container (forceDeepRefresh=${forceDeepRefresh})`, async () => {
          await viewProvider.refreshArtifactsContainer(
            TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
            forceDeepRefresh,
          );

          sinon.assert.calledOnceWithExactly(
            refreshResourceContainerStub,
            TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
            viewProvider.artifactsContainer,
            sinon.match.func, // loader methods tested separately
            forceDeepRefresh,
          );
          // not asserting the container was updated since that's handled in the
          // refreshResourceContainer tests above
        });

        it(`refreshRelationsContainer() should pass the relations container (forceDeepRefresh=${forceDeepRefresh})`, async () => {
          await viewProvider.refreshRelationsContainer(
            TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
            forceDeepRefresh,
          );

          sinon.assert.calledOnceWithExactly(
            refreshResourceContainerStub,
            TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
            viewProvider.relationsContainer,
            sinon.match.func,
            forceDeepRefresh,
          );
          // not asserting the container was updated since that's handled in the
          // refreshResourceContainer tests above
        });

        it(`refreshUDFsContainer() should pass the UDFs container (forceDeepRefresh=${forceDeepRefresh})`, async () => {
          await viewProvider.refreshUDFsContainer(
            TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
            forceDeepRefresh,
          );

          sinon.assert.calledOnceWithExactly(
            refreshResourceContainerStub,
            TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
            viewProvider.udfsContainer,
            sinon.match.func,
            forceDeepRefresh,
          );
          // not asserting the container was updated since that's handled in the
          // refreshResourceContainer tests above
        });

        it(`refreshAIConnectionsContainer() should pass the AI connections container (forceDeepRefresh=${forceDeepRefresh})`, async () => {
          await viewProvider.refreshAIConnectionsContainer(
            TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
            forceDeepRefresh,
          );

          sinon.assert.calledOnceWithExactly(
            refreshResourceContainerStub,
            TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
            viewProvider.aiConnectionsContainer,
            sinon.match.func,
            forceDeepRefresh,
          );
          // not asserting the container was updated since that's handled in the
          // refreshResourceContainer tests above
        });

        it(`refreshAIToolsContainer() should pass the AI tools container (forceDeepRefresh=${forceDeepRefresh})`, async () => {
          await viewProvider.refreshAIToolsContainer(
            TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
            forceDeepRefresh,
          );

          sinon.assert.calledOnceWithExactly(
            refreshResourceContainerStub,
            TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
            viewProvider.aiToolsContainer,
            sinon.match.func,
            forceDeepRefresh,
          );
          // not asserting the container was updated since that's handled in the
          // refreshResourceContainer tests above
        });

        it(`refreshAIModelsContainer() should pass the AI models container (forceDeepRefresh=${forceDeepRefresh})`, async () => {
          await viewProvider.refreshAIModelsContainer(
            TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
            forceDeepRefresh,
          );

          sinon.assert.calledOnceWithExactly(
            refreshResourceContainerStub,
            TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
            viewProvider.aiModelsContainer,
            sinon.match.func,
            forceDeepRefresh,
          );
          // not asserting the container was updated since that's handled in the
          // refreshResourceContainer tests above
        });

        it(`refreshAIAgentsContainer() should pass the AI agents container (forceDeepRefresh=${forceDeepRefresh})`, async () => {
          await viewProvider.refreshAIAgentsContainer(
            TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
            forceDeepRefresh,
          );

          sinon.assert.calledOnceWithExactly(
            refreshResourceContainerStub,
            TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
            viewProvider.aiAgentsContainer,
            sinon.match.func,
            forceDeepRefresh,
          );
          // not asserting the container was updated since that's handled in the
          // refreshResourceContainer tests above
        });
      }
    });

    describe("refreshResourceContainer wrappers' loader methods", () => {
      it("refreshArtifactsContainer() should pass the getFlinkArtifacts loader method", async () => {
        await viewProvider.refreshArtifactsContainer(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, false);

        sinon.assert.calledOnceWithExactly(
          ccloudLoader.getFlinkArtifacts,
          TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
          false,
        );
      });

      it("refreshRelationsContainer() should pass the getFlinkRelations loader method", async () => {
        await viewProvider.refreshRelationsContainer(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, false);

        sinon.assert.calledOnceWithExactly(
          ccloudLoader.getFlinkRelations,
          TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
          false,
        );
      });

      it("refreshUDFsContainer() should pass the getFlinkUDFs loader method", async () => {
        await viewProvider.refreshUDFsContainer(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, false);

        sinon.assert.calledOnceWithExactly(
          ccloudLoader.getFlinkUDFs,
          TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
          false,
        );
      });

      it("refreshAIConnectionsContainer() should pass the getFlinkAIConnections loader method", async () => {
        await viewProvider.refreshAIConnectionsContainer(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, false);

        sinon.assert.calledOnceWithExactly(
          ccloudLoader.getFlinkAIConnections,
          TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
          false,
        );
      });

      it("refreshAIToolsContainer() should pass the getFlinkAITools loader method", async () => {
        await viewProvider.refreshAIToolsContainer(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, false);

        sinon.assert.calledOnceWithExactly(
          ccloudLoader.getFlinkAITools,
          TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
          false,
        );
      });

      it("refreshAIModelsContainer() should pass the getFlinkAIModels loader method", async () => {
        await viewProvider.refreshAIModelsContainer(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, false);

        sinon.assert.calledOnceWithExactly(
          ccloudLoader.getFlinkAIModels,
          TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
          false,
        );
      });

      it("refreshAIAgentsContainer() should pass the getFlinkAIAgents loader method", async () => {
        await viewProvider.refreshAIAgentsContainer(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, false);

        sinon.assert.calledOnceWithExactly(
          ccloudLoader.getFlinkAIAgents,
          TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
          false,
        );
      });
    });

    describe("artifactsChangedHandler", () => {
      let refreshArtifactsStub: sinon.SinonStub;

      // matches the provider's default focused database:
      const testEnvProviderRegion: IEnvProviderRegion = {
        provider: TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.provider,
        region: TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.region,
        environmentId: TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.environmentId,
      };

      beforeEach(() => {
        refreshArtifactsStub = sandbox.stub(viewProvider, "refreshArtifactsContainer").resolves();
      });

      it("should do nothing if no database is selected", async () => {
        // no database selected
        viewProvider["resource"] = null;
        await viewProvider.artifactsChangedHandler(testEnvProviderRegion);

        sinon.assert.notCalled(refreshArtifactsStub);
      });

      it("should do nothing if the changed env/provider/region does not match the focused database", async () => {
        const otherDatabase = CCloudKafkaCluster.create({
          ...TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
          // some other env/provider/region
          environmentId: "env-999" as EnvironmentId,
          provider: "awsgcpazure",
          region: "planet-core99999",
        }) as CCloudFlinkDbKafkaCluster;
        viewProvider["resource"] = otherDatabase;

        await viewProvider.artifactsChangedHandler(testEnvProviderRegion);

        sinon.assert.notCalled(refreshArtifactsStub);
      });

      it("should refresh artifacts container when env/provider/region matches", async () => {
        // focused on TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER by default
        await viewProvider.artifactsChangedHandler(testEnvProviderRegion);

        sinon.assert.calledOnce(refreshArtifactsStub);
        sinon.assert.calledWith(refreshArtifactsStub, TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, true);
      });
    });

    describe("udfsChangedHandler", () => {
      let refreshUDFsStub: sinon.SinonStub;

      beforeEach(() => {
        refreshUDFsStub = sandbox.stub(viewProvider, "refreshUDFsContainer").resolves();
      });

      it("should do nothing if no database is selected", async () => {
        viewProvider["resource"] = null;
        await viewProvider.udfsChangedHandler({ id: "db-123" } as CCloudFlinkDbKafkaCluster);

        sinon.assert.notCalled(refreshUDFsStub);
      });

      it("should do nothing if the changed database does not match the selected database", async () => {
        const db = CCloudKafkaCluster.create({
          ...TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
          id: "db-999",
        }) as CCloudFlinkDbKafkaCluster;
        viewProvider["resource"] = db;

        await viewProvider.udfsChangedHandler({ id: "db-123" } as CCloudFlinkDbKafkaCluster);

        sinon.assert.notCalled(refreshUDFsStub);
      });

      it("should refresh UDFs container when database ID matches", async () => {
        const db = CCloudKafkaCluster.create({
          ...TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
          id: "db-999",
        }) as CCloudFlinkDbKafkaCluster;
        viewProvider["resource"] = db;

        await viewProvider.udfsChangedHandler(db);

        sinon.assert.calledOnce(refreshUDFsStub);
        sinon.assert.calledWith(refreshUDFsStub, db, true);
      });
    });

    describe("topicChangedHandler", () => {
      let refreshRelationsStub: sinon.SinonStub;

      beforeEach(() => {
        refreshRelationsStub = sandbox.stub(viewProvider, "refreshRelationsContainer");
      });

      it("should do nothing if no database is focused", async () => {
        viewProvider["resource"] = null;

        await viewProvider.topicChangedHandler({
          change: "added",
          cluster: TEST_CCLOUD_KAFKA_CLUSTER,
        });

        sinon.assert.notCalled(refreshRelationsStub);
      });

      for (const change of ["added", "deleted"] as EventChangeType[]) {
        it(`should do nothing if the cluster ID does not match the focused database ID (topic ${change})`, async () => {
          const db = CCloudKafkaCluster.create({
            ...TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
            id: "some-other-cluster-id",
          }) as CCloudFlinkDbKafkaCluster;
          viewProvider["resource"] = db;

          await viewProvider.topicChangedHandler({
            change,
            cluster: TEST_CCLOUD_KAFKA_CLUSTER,
          });

          sinon.assert.notCalled(refreshRelationsStub);
        });

        it(`should refresh the Relations container when the cluster ID matches the focused database ID (topic ${change})`, async () => {
          const matchingClusterId = "lkc-matching-cluster";
          const db = CCloudKafkaCluster.create({
            ...TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
            id: matchingClusterId,
          }) as CCloudFlinkDbKafkaCluster;
          viewProvider["resource"] = db;

          const matchingCluster = CCloudKafkaCluster.create({
            ...TEST_CCLOUD_KAFKA_CLUSTER,
            id: matchingClusterId,
          });
          await viewProvider.topicChangedHandler({
            change,
            cluster: matchingCluster,
          });

          sinon.assert.calledOnce(refreshRelationsStub);
          sinon.assert.calledWith(refreshRelationsStub, db, true);
        });
      }
    });

    describe("updateTreeViewDescription()", () => {
      const initialDescription = "Initial description";

      function getDescription(): string | undefined {
        return viewProvider["treeView"].description;
      }

      beforeEach(() => {
        viewProvider["treeView"].description = initialDescription;
      });

      it("does nothing when no database is set", async () => {
        viewProvider["resource"] = null;
        await viewProvider.updateTreeViewDescription();
        assert.strictEqual(getDescription(), "");
      });

      it("sets to mix of database name and environment name when database is set", async () => {
        viewProvider["resource"] = TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER; // in TEST_CCLOUD_ENVIRONMENT.

        const parentEnvironment = {
          ...TEST_CCLOUD_ENVIRONMENT,
          name: "Test Env Name",
        } as CCloudEnvironment;

        ccloudLoader.getEnvironment.resolves(parentEnvironment);

        await viewProvider.updateTreeViewDescription();

        assert.strictEqual(
          getDescription(),
          `${parentEnvironment.name} | ${TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.name}`,
        );
      });

      it("sets to database name when no parent environment is found", async () => {
        viewProvider["resource"] = TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER; // in TEST_CCLOUD_ENVIRONMENT.

        ccloudLoader.getEnvironment.resolves(undefined);

        await viewProvider.updateTreeViewDescription();

        assert.strictEqual(getDescription(), TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.name);
      });
    });
  });
});
