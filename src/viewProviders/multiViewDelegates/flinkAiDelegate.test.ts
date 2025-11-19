import * as assert from "assert";
import * as sinon from "sinon";
import { getStubbedCCloudResourceLoader } from "../../../tests/stubs/resourceLoaders";
import { TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER } from "../../../tests/unit/testResources";
import { createFlinkAIModel } from "../../../tests/unit/testResources/flinkAIModel";
import { getTestExtensionContext } from "../../../tests/unit/testUtils";
import type { CCloudResourceLoader } from "../../loaders";
import { FlinkAIModelTreeItem, type FlinkAIModel } from "../../models/flinkAiModel";
import { FlinkDatabaseViewProvider } from "../flinkDatabase";
import type { FlinkAIResource, FlinkAIViewModeData } from "./flinkAiDelegate";
import { FlinkAIDelegate } from "./flinkAiDelegate";
import { FlinkDatabaseResourceContainer } from "./flinkDatabaseResourceContainer";

// const testConnections = [createFlinkAIConnection("Connection1"), createFlinkAIConnection("Connection2")];
// const testTools = [createFlinkAITool("Tool1"), createFlinkAITool("Tool2")];
const testModels = [createFlinkAIModel("Model1"), createFlinkAIModel("Model2")];
// const testAgents = [createFlinkAIAgent("Agent1"), createFlinkAIAgent("Agent2")];

describe("viewProviders/multiViewDelegates/flinkAiDelegate", () => {
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

  describe("FlinkAiDelegate", () => {
    let provider: FlinkDatabaseViewProvider;
    let delegate: FlinkAIDelegate;
    let stubbedLoader: sinon.SinonStubbedInstance<CCloudResourceLoader>;

    beforeEach(() => {
      // don't actually create the Flink Database tree view during tests
      // sandbox.stub(window, "createTreeView");
      provider = FlinkDatabaseViewProvider.getInstance();
      delegate = new FlinkAIDelegate();
      stubbedLoader = getStubbedCCloudResourceLoader(sandbox);
    });

    afterEach(() => {
      provider.dispose();
      FlinkDatabaseViewProvider["instanceMap"].clear();
    });

    describe("fetchChildren()", () => {
      for (const forceDeepRefresh of [true, false]) {
        it(`should return an empty array when no Flink AI resources are available (forceDeepRefresh=${forceDeepRefresh})`, async () => {
          stubbedLoader.getFlinkAIModels.resolves([]);
          // stubbedLoader.getFlinkAIAgents.resolves([]);
          // stubbedLoader.getFlinkAIConnections.resolves([]);
          // stubbedLoader.getFlinkAITools.resolves([]);

          const children: FlinkAIViewModeData[] = await delegate.fetchChildren(
            TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
            forceDeepRefresh,
          );

          assert.deepStrictEqual(children, []);
          sinon.assert.calledOnce(stubbedLoader.getFlinkAIModels);
          sinon.assert.calledWithExactly(
            stubbedLoader.getFlinkAIModels,
            TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
            forceDeepRefresh,
          );
          // sinon.assert.calledOnce(stubbedLoader.getFlinkAIAgents);
          // sinon.assert.calledOnce(stubbedLoader.getFlinkAIConnections);
          // sinon.assert.calledOnce(stubbedLoader.getFlinkAITools);
        });

        it(`should include Flink AI models when returned from the loader (forceDeepRefresh=${forceDeepRefresh})`, async () => {
          stubbedLoader.getFlinkAIModels.resolves(testModels);

          const children: FlinkAIViewModeData[] = await delegate.fetchChildren(
            TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
            forceDeepRefresh,
          );

          // keep in mind this won't return the container objects, just the combined array of all
          // available AI resources
          assert.strictEqual(children.length, 2);
          assert.deepStrictEqual(children, testModels);
          // delegate should also keep track of the fetched models internally
          assert.deepStrictEqual(delegate["models"], testModels);
          sinon.assert.calledOnce(stubbedLoader.getFlinkAIModels);
          sinon.assert.calledWithExactly(
            stubbedLoader.getFlinkAIModels,
            TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
            forceDeepRefresh,
          );
        });
      }
    });

    describe("getChildren()", () => {
      it("should return resource containers when no element is provided", () => {
        const children: FlinkAIViewModeData[] = delegate.getChildren();

        assert.strictEqual(children.length, 4);
        const containers = children as FlinkDatabaseResourceContainer<FlinkAIResource>[];
        assert.strictEqual(containers[0].label, "Connections");
        assert.strictEqual(containers[1].label, "Tools");
        assert.strictEqual(containers[2].label, "Models");
        assert.strictEqual(containers[3].label, "Agents");
      });

      it("should create containers with current resources", () => {
        // delegate["connections"] = testConnections;
        // delegate["tools"] = testTools;
        delegate["models"] = testModels;
        // delegate["agents"] = testAgents;

        const children: FlinkAIViewModeData[] = delegate.getChildren();

        const containers = children as FlinkDatabaseResourceContainer<FlinkAIResource>[];
        assert.strictEqual(containers[0].label, "Connections");
        // assert.strictEqual(containers[0].children.length, testConnections.length);
        assert.strictEqual(containers[1].label, "Tools");
        // assert.strictEqual(containers[1].children.length, testTools.length);
        assert.strictEqual(containers[2].label, "Models");
        assert.strictEqual(containers[2].children.length, testModels.length);
        assert.strictEqual(containers[3].label, "Agents");
        // assert.strictEqual(containers[3].children.length, testAgents.length);
      });

      it("should return FlinkAIModels when a Models container is provided (expanded)", () => {
        const modelsContainer = new FlinkDatabaseResourceContainer<FlinkAIModel>(
          "Models",
          testModels,
        );

        const children: FlinkAIViewModeData[] = delegate.getChildren(modelsContainer);

        assert.strictEqual(children.length, 2);
        assert.deepStrictEqual(children, testModels);
      });
    });

    describe("getTreeItem()", () => {
      it("should return the FlinkDatabaseResourceContainers directly", () => {
        const container = new FlinkDatabaseResourceContainer("Connections", []);
        const treeItem = delegate.getTreeItem(container);

        assert.strictEqual(treeItem, container);
      });

      it("should return a FlinkAIModelTreeItem when given a FlinkAIModel", () => {
        const model = createFlinkAIModel("TestModel");
        const treeItem = delegate.getTreeItem(model);

        assert.ok(treeItem instanceof FlinkAIModelTreeItem);
        assert.strictEqual(treeItem.label, "TestModel");
        assert.strictEqual(treeItem.resource, model);
      });
    });
  });
});
