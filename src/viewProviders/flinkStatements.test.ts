import * as assert from "assert";
import * as sinon from "sinon";
import { window, workspace, WorkspaceConfiguration } from "vscode";
import {
  getStubbedCCloudResourceLoader,
  resetResourceLoaderStubs,
} from "../../tests/stubs/resourceLoaders";
import { TEST_CCLOUD_ENVIRONMENT } from "../../tests/unit/testResources";
import { TEST_CCLOUD_FLINK_COMPUTE_POOL } from "../../tests/unit/testResources/flinkComputePool";
import { createFlinkStatement } from "../../tests/unit/testResources/flinkStatement";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import { flinkStatementDeleted, flinkStatementUpdated } from "../emitters";
import { CCloudResourceLoader } from "../loaders";
import { FlinkStatement, Phase } from "../models/flinkStatement";
import {
  DEFAULT_STATEMENT_POLLING_CONCURRENCY,
  DEFAULT_STATEMENT_POLLING_FREQUENCY_SECONDS,
  DEFAULT_STATEMENT_POLLING_LIMIT,
  STATEMENT_POLLING_CONCURRENCY,
  STATEMENT_POLLING_FREQUENCY_SECONDS,
  STATEMENT_POLLING_LIMIT,
} from "../preferences/constants";
import * as telemetryEvents from "../telemetry/events";
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
    resetResourceLoaderStubs();
    sandbox.restore();
    // reset singleton instances between tests
    FlinkStatementsViewProvider["instanceMap"].clear();
  });

  describe("refresh()", () => {
    let changeFireStub: sinon.SinonStub;
    let resourcesClearStub: sinon.SinonStub;
    let logTelemetryStub: sinon.SinonStub;

    beforeEach(() => {
      changeFireStub = sandbox.stub(viewProvider["_onDidChangeTreeData"], "fire");
      resourcesClearStub = sandbox.stub(viewProvider["resourcesInTreeView"], "clear");
      logTelemetryStub = sandbox.stub(viewProvider, "logTelemetry");
    });

    it("clears when no resource is selected", async () => {
      // Should clear the resource map and fire the change event.
      await viewProvider.refresh();

      sinon.assert.calledOnce(changeFireStub);
      sinon.assert.calledOnce(resourcesClearStub);
      sinon.assert.notCalled(logTelemetryStub);
    });

    it("fetches new statements when a resource is selected", async () => {
      const windowWithProgressStub = sandbox
        .stub(window, "withProgress")
        .callsFake((_, callback) => {
          // Call the callback immediately with a resolved promise
          return Promise.resolve(callback({} as any, {} as any));
        });

      const resource = TEST_CCLOUD_ENVIRONMENT;
      viewProvider["resource"] = resource;

      const stubbedLoader: sinon.SinonStubbedInstance<CCloudResourceLoader> =
        getStubbedCCloudResourceLoader(sandbox);
      // Three statements total, one running and two stopped.
      stubbedLoader.getFlinkStatements.resolves([
        createFlinkStatement({
          name: "statement1",
          phase: Phase.RUNNING,
        }),
        createFlinkStatement({
          name: "statement2",
          phase: Phase.STOPPED,
        }),
        createFlinkStatement({
          name: "statement3",
          phase: Phase.STOPPED,
        }),
      ]);

      await viewProvider.refresh();

      sinon.assert.calledOnce(windowWithProgressStub);
      sinon.assert.calledOnce(resourcesClearStub);
      sinon.assert.calledTwice(changeFireStub);
      sinon.assert.calledOnce(stubbedLoader.getFlinkStatements);
      sinon.assert.calledOnce(logTelemetryStub);
      sinon.assert.calledWith(logTelemetryStub, 3, 1);
    });
  });

  /** Subset of workspace configs */
  type PollingConfigs = {
    nonterminalPollingFrequency: number | undefined;
    nonterminalPollingConcurrency: number | undefined;
    nonterminalStatementsToPoll: number | undefined;
  };

  describe("logTelemetry()", () => {
    let logUsageStub: sinon.SinonStub;
    let pollingConfigs: PollingConfigs;

    beforeEach(() => {
      // default to user not having any of our germane configs set at all.
      pollingConfigs = {
        nonterminalPollingFrequency: undefined,
        nonterminalPollingConcurrency: undefined,
        nonterminalStatementsToPoll: undefined,
      };

      logUsageStub = sandbox.stub(telemetryEvents, "logUsage");
      sandbox.stub(workspace, "getConfiguration").returns({
        get: (param: string) => {
          if (param === STATEMENT_POLLING_CONCURRENCY) {
            return pollingConfigs.nonterminalPollingConcurrency;
          }
          if (param === STATEMENT_POLLING_FREQUENCY_SECONDS) {
            return pollingConfigs.nonterminalPollingFrequency;
          }
          if (param === STATEMENT_POLLING_LIMIT) {
            return pollingConfigs.nonterminalStatementsToPoll;
          }
          return undefined;
        },
      } as WorkspaceConfiguration);
    });

    it("logs telemetry with compute_pool_id and default configs", () => {
      const totalStatements = 3;
      const nonTerminalStatements = 1;
      viewProvider["resource"] = TEST_CCLOUD_FLINK_COMPUTE_POOL;

      // Terrible custom configs.
      pollingConfigs.nonterminalPollingConcurrency = 1;
      pollingConfigs.nonterminalPollingFrequency = 2;
      pollingConfigs.nonterminalStatementsToPoll = 300;

      viewProvider.logTelemetry(totalStatements, nonTerminalStatements);

      sinon.assert.calledOnce(logUsageStub);
      sinon.assert.calledWith(
        logUsageStub,
        telemetryEvents.UserEvent.FlinkStatementViewStatistics,
        {
          compute_pool_id: TEST_CCLOUD_FLINK_COMPUTE_POOL.id,
          environment_id: undefined,

          statement_count: totalStatements,
          non_terminal_statement_count: nonTerminalStatements,
          terminal_statement_count: totalStatements - nonTerminalStatements,

          // Should have called with all the defaults, since this user
          // smells like not having set any of the polling configs.
          nonterminal_polling_concurrency: pollingConfigs.nonterminalPollingConcurrency,
          nonterminal_polling_frequency: pollingConfigs.nonterminalPollingFrequency,
          nonterminal_statements_to_poll: pollingConfigs.nonterminalStatementsToPoll,
        },
      );
    });

    it("logs telemetry with environment_id and custom configs", () => {
      const totalStatements = 7011;
      const nonTerminalStatements = 3053;
      viewProvider["resource"] = TEST_CCLOUD_ENVIRONMENT;
      viewProvider.logTelemetry(totalStatements, nonTerminalStatements);

      sinon.assert.calledOnce(logUsageStub);

      sinon.assert.calledWith(
        logUsageStub,
        telemetryEvents.UserEvent.FlinkStatementViewStatistics,
        {
          compute_pool_id: undefined,
          environment_id: TEST_CCLOUD_ENVIRONMENT.id,

          statement_count: totalStatements,
          non_terminal_statement_count: nonTerminalStatements,
          terminal_statement_count: totalStatements - nonTerminalStatements,

          // Should have called with all the defaults, since this user
          // smells like not having set any of the polling configs.
          nonterminal_polling_concurrency: DEFAULT_STATEMENT_POLLING_CONCURRENCY,
          nonterminal_polling_frequency: DEFAULT_STATEMENT_POLLING_FREQUENCY_SECONDS,
          nonterminal_statements_to_poll: DEFAULT_STATEMENT_POLLING_LIMIT,
        },
      );
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
    it("returns FlinkStatementTreeItem with label set to statement name", () => {
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
