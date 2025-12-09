import * as assert from "assert";
import * as sinon from "sinon";
import type { CancellationToken, Progress } from "vscode";
import { window } from "vscode";
import { getStubbedCCloudResourceLoader } from "../../tests/stubs/resourceLoaders";
import {
  TEST_CCLOUD_ENVIRONMENT,
  TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
} from "../../tests/unit/testResources";
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
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import { ResponseError } from "../clients/flinkArtifacts";
import type { CCloudResourceLoader } from "../loaders";
import type { CCloudEnvironment } from "../models/environment";
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
      it("should return an empty array when no database is set", () => {
        viewProvider["resource"] = null;

        const children = viewProvider.getChildren();

        assert.deepStrictEqual(children, []);
      });

      it("should return container items when a database is set", () => {
        viewProvider["resource"] = TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER;
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
      });

      it("should return container children when expanding a container", () => {
        viewProvider["resource"] = TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER;
        const testRelations = [TEST_FLINK_RELATION];
        const container = new FlinkDatabaseResourceContainer(
          FlinkDatabaseContainerLabel.RELATIONS,
          testRelations,
        );

        const children = viewProvider.getChildren(container);

        assert.deepStrictEqual(children, testRelations);
      });

      it("should return relation columns when expanding a relation", () => {
        viewProvider["resource"] = TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER;

        const children = viewProvider.getChildren(TEST_FLINK_RELATION);

        assert.deepStrictEqual(children, TEST_FLINK_RELATION.columns);
      });
    });

    describe("getTreeItem()", () => {
      it("should return a FlinkDatabaseResourceContainer directly", () => {
        const container = new FlinkDatabaseResourceContainer(
          FlinkDatabaseContainerLabel.RELATIONS,
          [],
        );
        const treeItem = viewProvider.getTreeItem(container);

        assert.strictEqual(treeItem, container);
      });

      it("should return a TreeItem from FlinkRelation.getTreeItem()", () => {
        const treeItem = viewProvider.getTreeItem(TEST_FLINK_RELATION);

        assert.strictEqual(treeItem.label, TEST_FLINK_RELATION.name);
      });

      it("should return a TreeItem from FlinkRelationColumn.getTreeItem()", () => {
        const treeItem = viewProvider.getTreeItem(TEST_VARCHAR_COLUMN);

        assert.strictEqual(treeItem.label, TEST_VARCHAR_COLUMN.name);
      });

      it("should return a FlinkArtifactTreeItem from a FlinkArtifact", () => {
        const treeItem = viewProvider.getTreeItem(
          createFlinkArtifact({ id: "art1", name: "TestArtifact" }),
        );

        assert.ok(treeItem instanceof FlinkArtifactTreeItem);
      });

      it("should return a FlinkUdfTreeItem from a FlinkUdf", () => {
        const treeItem = viewProvider.getTreeItem(createFlinkUDF("TestUDF"));

        assert.ok(treeItem instanceof FlinkUdfTreeItem);
      });

      it("should return a FlinkAIConnectionTreeItem from a FlinkAIConnection", () => {
        const treeItem = viewProvider.getTreeItem(createFlinkAIConnection("TestConnection"));

        assert.ok(treeItem instanceof FlinkAIConnectionTreeItem);
      });

      it("should return a FlinkAIModelTreeItem from a FlinkAIModel", () => {
        const treeItem = viewProvider.getTreeItem(createFlinkAIModel("TestModel"));

        assert.ok(treeItem instanceof FlinkAIModelTreeItem);
      });

      it("should return a FlinkAIToolTreeItem from a FlinkAITool", () => {
        const treeItem = viewProvider.getTreeItem(createFlinkAITool("TestTool"));

        assert.ok(treeItem instanceof FlinkAIToolTreeItem);
      });

      it("returns FlinkAIAgentTreeItem from FlinkAIAgent", () => {
        const treeItem = viewProvider.getTreeItem(createFlinkAIAgent("TestAgent"));

        assert.ok(treeItem instanceof FlinkAIAgentTreeItem);
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
        assert.ok((testContainer.tooltip as CustomMarkdownString).value.includes("Server Error"));
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
            viewProvider["artifactsContainer"],
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
            viewProvider["relationsContainer"],
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
            viewProvider["udfsContainer"],
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
            viewProvider["aiConnectionsContainer"],
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
            viewProvider["aiToolsContainer"],
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
            viewProvider["aiModelsContainer"],
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
            viewProvider["aiAgentsContainer"],
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
