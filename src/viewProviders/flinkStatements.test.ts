import * as assert from "assert";
import * as sinon from "sinon";
import { window } from "vscode";
import { TEST_CCLOUD_ENVIRONMENT } from "../../tests/unit/testResources";
import { TEST_CCLOUD_FLINK_COMPUTE_POOL } from "../../tests/unit/testResources/flinkComputePool";
import { createFlinkStatement } from "../../tests/unit/testResources/flinkStatement";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import { flinkStatementDeleted, flinkStatementUpdated } from "../emitters";
import { CCloudResourceLoader, ResourceLoader } from "../loaders";
import { FlinkStatement } from "../models/flinkStatement";
import { FlinkStatementsViewProvider } from "./flinkStatements";

describe("FlinkStatementsViewProvider", () => {
  let sandbox: sinon.SinonSandbox;
  let viewProvider: FlinkStatementsViewProvider;
  let resourcesInTreeView: Map<string, FlinkStatement>;

  before(async () => {
    // required for all subclasses of BaseViewProvider since they deal with extension storage
    await getTestExtensionContext();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    viewProvider = FlinkStatementsViewProvider.getInstance();
    resourcesInTreeView = viewProvider["resourcesInTreeView"];
  });

  afterEach(() => {
    sandbox.restore();
    // reset singleton instances between tests
    FlinkStatementsViewProvider["instanceMap"].clear();
  });

  describe("refresh()", () => {
    let changeFireStub: sinon.SinonStub;
    let resourcesClearStub: sinon.SinonStub;

    beforeEach(() => {
      changeFireStub = sandbox.stub(viewProvider["_onDidChangeTreeData"], "fire");
      resourcesClearStub = sandbox.stub(viewProvider["resourcesInTreeView"], "clear");
    });

    it("clears when no resource is selected", async () => {
      // Should clear the resource map and fire the change event.
      await viewProvider.refresh();

      sinon.assert.calledOnce(changeFireStub);
      sinon.assert.calledOnce(resourcesClearStub);
    });

    it("fetches new statements when a resource is selected", async () => {
      const resourceLoader = sinon.createStubInstance(CCloudResourceLoader);
      sandbox.stub(ResourceLoader, "getInstance").returns(resourceLoader);
      const windowWithProgressStub = sandbox
        .stub(window, "withProgress")
        .callsFake((_, callback) => {
          // Call the callback immediately with a resolved promise
          return Promise.resolve(callback({} as any, {} as any));
        });

      const resource = TEST_CCLOUD_ENVIRONMENT;
      viewProvider["resource"] = resource;

      // Mock the getFlinkStatements method to return a resolved promise
      resourceLoader.getFlinkStatements.resolves([]);

      await viewProvider.refresh();

      sinon.assert.calledOnce(windowWithProgressStub);
      sinon.assert.calledOnce(resourcesClearStub);
      sinon.assert.calledTwice(changeFireStub);
      sinon.assert.calledOnce(resourceLoader.getFlinkStatements);
    });
  });

  describe("getChildren()", () => {
    it("returns empty array when resourcesInTreeView is empty", async () => {
      resourcesInTreeView.clear();
      const children = await viewProvider.getChildren();

      assert.deepStrictEqual(children, []);
    });

    describe("behavior with resourcesInTreeView populated", () => {
      const oldestStatement = createFlinkStatement({
        name: "papa", // bear ommitted to test filtering.
        createdAt: new Date("2023-01-01"),
      });

      const middleStatement = createFlinkStatement({
        name: "mama bear",
        createdAt: new Date("2024-01-02"),
      });
      const youngestStatement = createFlinkStatement({
        name: "baby bear",
        createdAt: new Date("2025-01-03"),
      });

      beforeEach(() => {
        resourcesInTreeView.clear();
        for (const statement of [oldestStatement, middleStatement, youngestStatement]) {
          resourcesInTreeView.set(statement.id, statement);
        }
      });

      it("returns sorted array of FlinkStatement unfiltered", async () => {
        const children = await viewProvider.getChildren();
        assert.deepStrictEqual(children, [youngestStatement, middleStatement, oldestStatement]);
      });

      it("returns sorted array of FlinkStatement filtered by name", async () => {
        viewProvider.itemSearchString = "bear";
        const children = await viewProvider.getChildren();
        // papa's last name isnt bear.
        assert.deepStrictEqual(children, [youngestStatement, middleStatement]);
      });

      describe("setCustomEventListeners() listener behavior", () => {
        let onDidChangeTreeDataFireStub: sinon.SinonStub;

        beforeEach(() => {
          onDidChangeTreeDataFireStub = sandbox.stub(viewProvider["_onDidChangeTreeData"], "fire");
        });

        describe("flinkStatementUpdated", () => {
          it("updates reference to existing statements when flinkStatementUpdated fires", () => {
            const statement = createFlinkStatement({
              name: middleStatement.name,
              updatedAt: new Date("2025-01-02"),
            });

            flinkStatementUpdated.fire(statement);

            // Check that the statement was updated in the resourcesInTreeView map
            const updatedStatement = resourcesInTreeView.get(statement.id);
            assert.strictEqual(updatedStatement?.updatedAt, statement.updatedAt);

            // Check that the fire method was called
            sinon.assert.calledOnce(onDidChangeTreeDataFireStub);
            sinon.assert.calledWith(onDidChangeTreeDataFireStub, updatedStatement);
          });

          it("handles update of statement that is not in the view", () => {
            const statement = createFlinkStatement({
              name: "not in view",
              updatedAt: new Date("2025-01-02"),
            });
            flinkStatementUpdated.fire(statement);
            // Check that the statement was not added to the resourcesInTreeView map
            const updatedStatement = resourcesInTreeView.get(statement.id);
            assert.strictEqual(updatedStatement, undefined);
            // Check that the fire method was not called
            sinon.assert.notCalled(onDidChangeTreeDataFireStub);
          });
        });

        describe("flinkStatementDeleted", () => {
          it("removes statement from resourcesInTreeView when flinkStatementDeleted fires", () => {
            flinkStatementDeleted.fire(oldestStatement.id);
            // Should call the fire method with no arguments.
            sinon.assert.calledOnce(onDidChangeTreeDataFireStub);
            // Want to spell like this, but it fails:
            // sinon.assert.calledOnceWithExactly(onDidChangeTreeDataFireStub, undefined);
            // So have to old-school it, and it passes.
            assert.strictEqual(onDidChangeTreeDataFireStub.args[0][0], undefined);
          });

          it("handles deletion of statement that is not in the view", () => {
            const statement = createFlinkStatement({
              name: "not in view",
              updatedAt: new Date("2025-01-02"),
            });
            flinkStatementDeleted.fire(statement.id);
            // No fire, no removals.
            sinon.assert.notCalled(onDidChangeTreeDataFireStub);
            assert.strictEqual(resourcesInTreeView.size, 3);
          });
        });
      });
    });
  });

  describe("focus()", () => {
    it("calls treeView.reveal() with the correct statement", async () => {
      const statement = createFlinkStatement();
      resourcesInTreeView.set(statement.id, statement);
      const revealStub = sandbox.stub(viewProvider["treeView"], "reveal");
      await viewProvider.focus(statement.id);
      sinon.assert.calledOnce(revealStub);
      sinon.assert.calledWith(revealStub, statement, { focus: true, select: true });
    });

    it("throws if reveal() fails", async () => {
      const statement = createFlinkStatement();
      resourcesInTreeView.set(statement.id, statement);
      const revealStub = sandbox.stub(viewProvider["treeView"], "reveal").throws();
      await assert.rejects(
        async () => {
          await viewProvider.focus(statement.id);
        },
        {
          name: "Error",
          message: "Error",
        },
      );
      sinon.assert.calledOnce(revealStub);
      sinon.assert.calledWith(revealStub, statement, { focus: true, select: true });
    });

    it("throws error if statement not found", async () => {
      const statementId = "non-existent-statement-id";
      assert.rejects(
        async () => {
          await viewProvider.focus(statementId);
        },
        {
          name: "Error",
          message: `Could not find statement ${statementId} in the view`,
        },
      );
    });
  });

  describe("getParent()", () => {
    it("always returns null", () => {
      const parent = viewProvider.getParent();
      assert.strictEqual(parent, null);
    });
  });

  describe("getTreeItem()", () => {
    it("with label set to statement name", () => {
      const statement = createFlinkStatement();
      const treeItem = viewProvider.getTreeItem(statement);
      assert.strictEqual(treeItem.label, statement.name);
    });
  });

  describe("get computePool()", () => {
    it("returns null if no resource set", () => {
      const computePool = viewProvider.computePool;
      assert.strictEqual(computePool, null);
    });

    it("returns null if resource set to an environment", () => {
      viewProvider["resource"] = TEST_CCLOUD_ENVIRONMENT;
      const computePool = viewProvider.computePool;
      assert.strictEqual(computePool, null);
    });

    it("returns CCloudFlinkComputePool if resource set to a compute pool", () => {
      const computePool = TEST_CCLOUD_FLINK_COMPUTE_POOL;
      viewProvider["resource"] = computePool;
      const result = viewProvider.computePool;
      assert.strictEqual(result, computePool);
    });
  });
});
