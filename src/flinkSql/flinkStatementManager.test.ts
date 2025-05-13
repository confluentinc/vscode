import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { ConfigurationChangeEvent } from "vscode";
import { createFlinkStatement } from "../../tests/unit/testResources/flinkStatement";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import { ccloudConnected, flinkStatementUpdated } from "../emitters";
import { CCloudResourceLoader } from "../loaders";
import { FlinkStatement, FlinkStatementId, STOPPED_PHASE } from "../models/flinkStatement";
import {
  DEFAULT_STATEMENT_POLLING_CONCURRENCY,
  DEFAULT_STATEMENT_POLLING_FREQUENCY,
  DEFAULT_STATEMENT_POLLING_LIMIT,
  ENABLE_FLINK,
  STATEMENT_POLLING_CONCURRENCY,
  STATEMENT_POLLING_FREQUENCY,
  STATEMENT_POLLING_LIMIT,
} from "../preferences/constants";
import { IntervalPoller } from "../utils/timing";
import * as workerPool from "../utils/workerPool";
import {
  FlinkStatementManager,
  FlinkStatementManagerConfiguration,
  MonitoredStatement,
  MonitoredStatements,
} from "./flinkStatementManager";

describe("flinkStatementManager.ts", () => {
  before(async () => {
    // otherwise logging calls when debugging will fail
    // due to not having determined writeable tmpdir
    // yet. Sigh.
    await getTestExtensionContext();
  });

  describe("FlinkStatementManager", () => {
    let sandbox: sinon.SinonSandbox;

    let instance: FlinkStatementManager;
    let testConfigState: FlinkStatementManagerConfiguration;
    let configStub: sinon.SinonStub;
    let onDidChangeConfigurationStub: sinon.SinonStub;
    let resetPoller: () => IntervalPoller | void;
    let monitoredStatements: MonitoredStatements;

    function resetConfiguration(): FlinkStatementManagerConfiguration {
      return {
        pollingFrequency: DEFAULT_STATEMENT_POLLING_FREQUENCY,
        maxStatementsToPoll: DEFAULT_STATEMENT_POLLING_LIMIT,
        concurrency: DEFAULT_STATEMENT_POLLING_CONCURRENCY,
        flinkEnabled: true,
      };
    }

    async function setWorkspacePollingFrequencySetting(value: number): Promise<void> {
      // Set up the current workspace settings polling frequency
      testConfigState.pollingFrequency = value;
      // Now simulate the event that would be fired when the configuration changes
      await driveConfigChangeListener(STATEMENT_POLLING_FREQUENCY);
    }

    async function setWorkspacePollingLimitSetting(value: number): Promise<void> {
      // Set up the current workspace settings polling frequency max statements to poll
      testConfigState.maxStatementsToPoll = value;
      // Now simulate the event that would be fired when the configuration changes
      await driveConfigChangeListener(STATEMENT_POLLING_LIMIT);
    }

    async function setWorkspacePollingConcurrencySetting(value: number): Promise<void> {
      // Set up the current workspace settings polling concurrenct
      testConfigState.concurrency = value;
      // Now simulate the event that would be fired when the configuration changes
      await driveConfigChangeListener(STATEMENT_POLLING_CONCURRENCY);
    }

    async function setWorkspaceFlinkEnabled(value: boolean): Promise<void> {
      testConfigState.flinkEnabled = value;
      // Now simulate the event that would be fired when the configuration changes
      await driveConfigChangeListener(ENABLE_FLINK);
    }

    async function driveConfigChangeListener(configName: string): Promise<void> {
      // Simulate the event that would be fired when the given configuration changes
      const mockEvent = {
        affectsConfiguration: (config: string) => config === configName,
      } as ConfigurationChangeEvent;

      onDidChangeConfigurationStub.yields(mockEvent);

      // Call the event handler wired up in construct / createConfigChangeListener().
      // Will end up observing the settings in `testConfigState`.
      await onDidChangeConfigurationStub.firstCall.args[0](mockEvent);
    }

    beforeEach(() => {
      sandbox = sinon.createSandbox();
      onDidChangeConfigurationStub = sandbox.stub(vscode.workspace, "onDidChangeConfiguration");
      onDidChangeConfigurationStub.returns({ dispose: () => {} });
      testConfigState = resetConfiguration();

      // Fake implementation of workspace.getConfiguration
      const configMock = {
        get: sandbox.fake((configName: string) => {
          switch (configName) {
            case STATEMENT_POLLING_FREQUENCY:
              return testConfigState.pollingFrequency;
            case STATEMENT_POLLING_LIMIT:
              return testConfigState.maxStatementsToPoll;
            case STATEMENT_POLLING_CONCURRENCY:
              return testConfigState.concurrency;
            case ENABLE_FLINK:
              return testConfigState.flinkEnabled;
            default:
              throw new Error(`Unknown config name: ${configName}`);
          }
        }),
      };
      configStub = sandbox.stub(vscode.workspace, "getConfiguration");
      configStub.returns(configMock);

      // Be sure to get ahold of a new instance of the FlinkStatementManager
      FlinkStatementManager["instance"] = undefined;
      instance = FlinkStatementManager.getInstance();

      resetPoller = instance["resetPoller"].bind(instance);

      monitoredStatements = instance["monitoredStatements"];
    });

    afterEach(() => {
      sandbox.restore();
      FlinkStatementManager["instance"] = undefined;
    });

    describe("getConfiguration()", () => {
      it("should return the configuration object", () => {
        const config = FlinkStatementManager.getConfiguration();
        assert.deepStrictEqual(config, testConfigState);
      });

      it("Should fix concurrency to be at least 1", () => {
        testConfigState.concurrency = 0;
        const config = FlinkStatementManager.getConfiguration();
        assert.strictEqual(config.concurrency, DEFAULT_STATEMENT_POLLING_CONCURRENCY);
      });

      it("Should fix polling frequency to be at least 0", () => {
        testConfigState.pollingFrequency = -1;
        const config = FlinkStatementManager.getConfiguration();
        assert.strictEqual(config.pollingFrequency, DEFAULT_STATEMENT_POLLING_FREQUENCY);
      });

      it("Should fix max statements to poll to be at least 1", () => {
        testConfigState.maxStatementsToPoll = 0;
        const config = FlinkStatementManager.getConfiguration();
        assert.strictEqual(config.maxStatementsToPoll, DEFAULT_STATEMENT_POLLING_LIMIT);
      });
    }); // getConfiguration

    describe("isEnabled()", () => {
      it("should return true if polling frequency > 0", () => {
        assert.ok(instance.isEnabled());
      });

      it("should return false if configuration changes to polling frequency == 0", async () => {
        await setWorkspacePollingFrequencySetting(0);

        // Check that the isEnabled property is now false
        assert.strictEqual(instance.isEnabled(), false);
      });

      it("should return false if configuration changes to flink disabled", async () => {
        testConfigState.flinkEnabled = false;
        await driveConfigChangeListener(ENABLE_FLINK);
        // Check that the isEnabled property is now false
        assert.strictEqual(instance.isEnabled(), false);
      });
    }); // isEnable

    describe("shouldPoll()", () => {
      it("should return false if enabled and no statements to monitor", () => {
        assert.strictEqual(false, instance.shouldPoll());
      });

      it("should return true if enabled and has statements to monitor", () => {
        const statement = createFlinkStatement();
        instance.register("client", statement);
        assert.strictEqual(true, instance.shouldPoll());
      });

      it("should return false if not enabled but has statements to monitor", async () => {
        const statement = createFlinkStatement();
        instance.register("client", statement);

        await setWorkspacePollingFrequencySetting(0);

        assert.strictEqual(false, instance.shouldPoll());
      });
    }); // shouldPoll()

    describe("changing flink enabled setting", () => {
      it("should stop the poller and disable if reset to false", async () => {
        instance.register("client", createFlinkStatement());
        const oldPoller = instance["poller"]!;
        assert.strictEqual(oldPoller.isRunning(), true);
        assert.strictEqual(instance.isEnabled(), true);

        await setWorkspaceFlinkEnabled(false);

        assert.strictEqual(instance.isEnabled(), false);
        assert.strictEqual(oldPoller.isRunning(), false);
        assert.strictEqual(instance["poller"], undefined);
        // will not clear statements in case they turn back on again.
        assert.strictEqual(monitoredStatements.isEmpty(), false);
      });

      it("should start the poller and enable if reset to true", async () => {
        await setWorkspaceFlinkEnabled(false);

        assert.strictEqual(instance.isEnabled(), false);
        assert.strictEqual(instance["poller"], undefined);

        await setWorkspaceFlinkEnabled(true);

        assert.strictEqual(instance.isEnabled(), true);
        // will have made a poller, but not started it yet since no statements.
        assert.ok(instance["poller"]);
        // Will have a poller, but not started it yet since no statements.
        // @ts-expect-error poller will be assigned.
        assert.strictEqual(instance["poller"].isRunning(), false);
      });
    });

    describe("resetPoller()", () => {
      it("Should return a new stopped poller if enabled", () => {
        const poller = resetPoller();
        assert.ok(poller);
        assert.strictEqual(poller.isRunning(), false);
      });

      it("Should return undefined if not enabled", async () => {
        await setWorkspacePollingFrequencySetting(0);
        const poller = resetPoller();
        assert.strictEqual(poller, undefined);
      });

      it("Should return a new poller if already running", () => {
        const poller = resetPoller();
        assert.ok(poller);
        assert.strictEqual(poller.isRunning(), false);

        // Call again to check if it returns a new poller
        const newPoller = resetPoller();
        assert.notStrictEqual(poller, newPoller);
      });

      it("Should start the created poller if shouldPoll() is true", () => {
        const statement = createFlinkStatement();
        instance.register("testClientId", statement);

        const poller = resetPoller();
        assert.ok(poller);
        assert.strictEqual(poller.isRunning(), true);
        poller.stop();
      });

      it("Will stop the old poller if it is running", () => {
        const poller = resetPoller();
        assert.ok(poller);
        sandbox.stub(poller, "isRunning").returns(true);
        instance["poller"] = poller;

        const stopStub = sandbox.stub(poller, "stop");
        resetPoller();
        sinon.assert.calledOnce(stopStub);
      });
    }); // resetPoller()

    describe("register()", () => {
      it("should register a new statement and then start up", () => {
        // stopped at first
        assert.strictEqual(instance["poller"]!.isRunning(), false);
        const statement = createFlinkStatement();
        instance.register("testClientId", statement);
        // now it should be running
        assert.strictEqual(instance["poller"]!.isRunning(), true);
        assert.strictEqual(monitoredStatements.getAll().length, 1);
      });

      it("handles many statements at once", () => {
        const statement1 = createFlinkStatement();
        const statement2 = createFlinkStatement({
          name: "other",
        });
        instance.register("testClientId", [statement1, statement2]);
        assert.strictEqual(instance["poller"]!.isRunning(), true);
        assert.strictEqual(monitoredStatements.getAll().length, 2);
      });
    }); // register()

    describe("clearClient()", () => {
      it("should clear all statements for a clientId", () => {
        const statement1 = createFlinkStatement();
        const statement2 = createFlinkStatement({
          name: "other",
        });
        instance.register("testClientId", [statement1, statement2]);
        assert.strictEqual(instance["poller"]!.isRunning(), true);
        assert.strictEqual(monitoredStatements.getAll().length, 2);

        instance.clearClient("testClientId");
        assert.strictEqual(monitoredStatements.getAll().length, 0);
        // poller should be stopped since no statements are left
        assert.strictEqual(instance["poller"]!.isRunning(), false);
      });
      it("should not clear other clients' statements", () => {
        const statement1 = createFlinkStatement();
        const statement2 = createFlinkStatement({
          name: "other",
        });
        instance.register("testClientId", [statement1, statement2]);
        instance.register("otherClientId", statement1);
        assert.strictEqual(monitoredStatements.getAll().length, 2);

        instance.clearClient("testClientId");
        assert.strictEqual(monitoredStatements.getAll().length, 1);
        // poller should be running since still some statements left.
        assert.strictEqual(instance["poller"]!.isRunning(), true);
      });
      it("handles clearing all when no poller exists", async () => {
        // Register statement, will start the poller.
        instance.register("testClientId", createFlinkStatement());

        // Now reconfigure to not have a poller. Will stop and set .poller to undefined.
        await setWorkspacePollingFrequencySetting(0);

        // Now clear the client. Should not throw.
        instance.clearClient("testClientId");
        assert.strictEqual(monitoredStatements.getAll().length, 0);
      });
    }); // clearClient()

    describe("getStatementsToPoll()", () => {
      const statement1 = createFlinkStatement({
        name: "statement1",
        updatedAt: new Date("2024-01-01"),
      });
      const statement2 = createFlinkStatement({
        name: "statement2",
        updatedAt: new Date("2024-01-02"),
      });
      const statement3 = createFlinkStatement({
        name: "statement3",
        updatedAt: new Date("2024-01-03"),
      });

      beforeEach(async () => {
        // Register the three statements
        instance.register("testClientId", [statement1, statement2, statement3]);
        // Ensure we're configured to be able to poll > 3 at a time. Prior tests
        // may have reset this.
        await setWorkspacePollingLimitSetting(10);
      });

      it("Should return statements most recently updated first", () => {
        const statementsToPoll = instance.getStatementsToPoll();
        assert.strictEqual(statementsToPoll.length, 3);
        // won't be in any particular order since did not have
        // to sort + limit.
      });

      it("honors the max statements to poll setting + return most recent first", async () => {
        // Set the max statements to poll to 2
        await setWorkspacePollingLimitSetting(2);

        // Should return the two most recent statements
        const statementsToPoll = instance.getStatementsToPoll();
        assert.strictEqual(statementsToPoll.length, 2);
        assert.strictEqual(statementsToPoll[0], statement3);
        assert.strictEqual(statementsToPoll[1], statement2);
      });
    }); // getStatementsToPoll()

    describe("pollStatements()", () => {
      const statement1 = createFlinkStatement({
        name: "statement1",
        updatedAt: new Date("2024-01-01"),
      });

      const statement2 = createFlinkStatement({
        name: "statement2",
        updatedAt: new Date("2024-01-02"),
      });

      function registerStatements(): void {
        const statements = [statement1, statement2];
        instance.register("testClientId", statements);
      }

      let resourceLoaderStub: sinon.SinonStubbedInstance<CCloudResourceLoader>;
      let refreshFlinkStatementStub: sinon.SinonStub;

      beforeEach(() => {
        resourceLoaderStub = sandbox.createStubInstance(CCloudResourceLoader);
        sandbox.stub(CCloudResourceLoader, "getInstance").returns(resourceLoaderStub);
        refreshFlinkStatementStub = resourceLoaderStub.refreshFlinkStatement;
      });

      it("should avoid reentrancy", async () => {
        registerStatements();
        // As if there's another run going.
        instance["isPolling"] = true;

        await instance.pollStatements();

        sinon.assert.notCalled(refreshFlinkStatementStub);
      });

      it("Should short-circuit if no statements to poll", async () => {
        // No statements registered
        assert.strictEqual(monitoredStatements.isEmpty(), true);
        await instance.pollStatements();

        sinon.assert.notCalled(refreshFlinkStatementStub);

        // And that isPolling is set to false when done..
        assert.strictEqual(instance["isPolling"], false);
      });

      it("Should call refreshFlinkStatement() for each statement", async () => {
        registerStatements();

        // Will be the updated date for statement1
        const newDate = new Date("2025-01-01");
        assert.ok(newDate.getTime() > statement1.updatedAt!.getTime());

        refreshFlinkStatementStub.callsFake(async (statement): Promise<FlinkStatement | null> => {
          // if is statement1, return new representation with newer updatedAt.
          if (statement.id === statement1.id) {
            return createFlinkStatement({
              name: statement.name,
              updatedAt: newDate,
            });
          } else {
            // as if statement2 has been deleted.
            return null;
          }
        });

        await instance.pollStatements();

        sinon.assert.calledTwice(refreshFlinkStatementStub);

        // Only statement1 should remain, and should be
        // with the new updatedAt date.
        assert.strictEqual(monitoredStatements.getAll().length, 1);
        const monitoredStatement = monitoredStatements.getAll()[0];
        assert.strictEqual(monitoredStatement.id, statement1.id);
        assert.strictEqual(monitoredStatement.updatedAt!.getTime(), newDate.getTime());
        assert.strictEqual(instance["isPolling"], false);
      });

      it("workerpool concurrency should be respected", async () => {
        // inject spy over executeInWorkerPool
        const executeInWorkerPoolSpy = sandbox.spy(workerPool, "executeInWorkerPool");

        registerStatements();

        // Set the concurrency to 8
        await setWorkspacePollingConcurrencySetting(8);

        // Poll.
        await instance.pollStatements();

        sinon.assert.calledOnce(executeInWorkerPoolSpy);

        // Check that the called concurrency was set to 8
        assert.strictEqual(executeInWorkerPoolSpy.firstCall.args[2]!.maxWorkers, 8);
      });

      it("Should stop poller if no statements left", async () => {
        registerStatements();
        // Will have started the poller.
        assert.strictEqual(instance["poller"]!.isRunning(), true);

        refreshFlinkStatementStub.callsFake(async (statement): Promise<FlinkStatement | null> => {
          // as if statement is now in stopped phase.
          return createFlinkStatement({
            name: statement.name,
            updatedAt: new Date("2025-01-01"),
            phase: STOPPED_PHASE,
          });
        });
        await instance.pollStatements();
        sinon.assert.calledTwice(refreshFlinkStatementStub);
        // should have removed all statements
        assert.strictEqual(monitoredStatements.getAll().length, 0);
        // poller should be stopped since no statements are left
        assert.strictEqual(instance["poller"]!.isRunning(), false);
        assert.strictEqual(instance["isPolling"], false);
      });

      it("Handles unexpected errors", async () => {
        registerStatements();
        // Simulate an unexpected error in the refreshFlinkStatement call
        refreshFlinkStatementStub.callsFake(() => {
          throw new Error("Simulated error");
        });
        await instance.pollStatements();
        // should have called the refreshFlinkStatement method 2x
        sinon.assert.calledTwice(refreshFlinkStatementStub);
        // should not have removed any statements
        assert.strictEqual(monitoredStatements.getAll().length, 2);
        assert.strictEqual(instance["isPolling"], false);
      });
    }); // pollStatements()

    describe("createCcloudAuthListener()", () => {
      it("Should reset poller on ccloudConnected=true", async () => {
        const resetPollerStub = sandbox.stub(instance, "resetPoller");
        ccloudConnected.fire(true);

        sinon.assert.calledOnce(resetPollerStub);
      });

      it("Should stop poller and clear statements on ccloudConnected=false", async () => {
        const clearClientStub = sandbox.stub(monitoredStatements, "clear");
        const stopPollerStub = sandbox.stub(instance["poller"]!, "stop");

        ccloudConnected.fire(false);

        sinon.assert.calledOnce(stopPollerStub);
        sinon.assert.calledOnce(clearClientStub);
      });

      it("Skips poller stop if no poller exists on ccloudConnected=false", async () => {
        // Set the poller to undefined
        instance["poller"] = undefined;

        const clearClientStub = sandbox.stub(monitoredStatements, "clear");

        ccloudConnected.fire(false);

        sinon.assert.calledOnce(clearClientStub);
      });
    }); // createCcloudAuthListener()

    describe("dispose()", () => {
      it("Should stop the poller and clear statements", () => {
        const stopPollerStub = sandbox.stub(instance["poller"]!, "stop");
        const monitoredStatementClearStub = sandbox.stub(monitoredStatements, "clear");

        instance.dispose();

        sinon.assert.calledOnce(stopPollerStub);
        sinon.assert.calledOnce(monitoredStatementClearStub);
      });
      it("Should not throw if poller is undefined", () => {
        // Set the poller to undefined
        instance["poller"] = undefined;

        const monitoredStatementClearStub = sandbox.stub(monitoredStatements, "clear");

        instance.dispose();

        sinon.assert.calledOnce(monitoredStatementClearStub);
      });
    }); // dispose()
  }); // describe FlinkStatementManager

  describe("MonitoredStatements", () => {
    let sandbox: sinon.SinonSandbox;
    let flinkStatementUpdatedFired: sinon.SinonStub;

    const initialStatementDate = new Date("2024-01-01");
    const clientId = "testClientId";
    let statement: FlinkStatement;
    let instance: MonitoredStatements;
    let monitoredMap: Map<FlinkStatementId, MonitoredStatement>;

    beforeEach(() => {
      // by default will make a RUNNING state statement, nonterminal.
      sandbox = sinon.createSandbox();
      flinkStatementUpdatedFired = sandbox.stub(flinkStatementUpdated, "fire");

      statement = createFlinkStatement({ updatedAt: initialStatementDate });
      instance = new MonitoredStatements();
      monitoredMap = instance["monitored"];
    });

    afterEach(() => {
      sandbox.restore();
    });

    describe("register()", () => {
      it("should register a single new nonterminal statement + client for new statement", () => {
        instance.register(clientId, statement);
        assert.strictEqual(instance.isEmpty(), false);
        assert.strictEqual(monitoredMap.size, 1);
        assert.deepStrictEqual(instance.getAll(), [statement]);

        const monitoredStatement = monitoredMap.get(statement.id);
        assert.ok(monitoredStatement);
        assert.strictEqual(monitoredStatement.clientIds.size, 1);
        assert.ok(monitoredStatement.clientIds.has(clientId));

        // Adding 1st clientId should NOT fire the event.
        sinon.assert.notCalled(flinkStatementUpdatedFired);
      });

      it("should register many new statements at once", () => {
        const statements = [
          statement,
          createFlinkStatement({ name: "other", updatedAt: new Date("2024-01-02") }),
        ];

        instance.register(clientId, statements);
        assert.strictEqual(monitoredMap.size, 2);
        for (const statement of statements) {
          const monitoredStatement = monitoredMap.get(statement.id);
          assert.ok(monitoredStatement);
          assert.strictEqual(monitoredStatement.clientIds.size, 1);
        }

        sinon.assert.notCalled(flinkStatementUpdatedFired);
      });

      it("should register a new clientId for an existing statement", () => {
        instance.register(clientId, statement);
        instance.register("newClientId", statement);

        assert.strictEqual(monitoredMap.size, 1);
        const monitoredStatement = monitoredMap.get(statement.id);
        assert.ok(monitoredStatement);
        assert.strictEqual(monitoredStatement.clientIds.size, 2);

        // Adding a 2nd clientId for not fresher version should NOT fire the event.
        sinon.assert.notCalled(flinkStatementUpdatedFired);
      });

      it("registering fresher version should fire event", () => {
        const fresherStatement = createFlinkStatement({
          updatedAt: new Date("2024-01-02"),
        });

        instance.register(clientId, statement);
        instance.register("otherClient", fresherStatement);

        assert.strictEqual(monitoredMap.size, 1);
        const monitoredStatement = monitoredMap.get(statement.id);
        assert.ok(monitoredStatement);
        assert.ok(monitoredStatement.statement === fresherStatement);
        assert.strictEqual(monitoredStatement.clientIds.size, 2);

        // Adding the fresher version should fire the event.
        sinon.assert.calledOnce(flinkStatementUpdatedFired);
        sinon.assert.calledWith(flinkStatementUpdatedFired, fresherStatement);
      });

      it("cannot add a terminal statement", () => {
        const terminalStatement = createFlinkStatement({
          phase: STOPPED_PHASE,
        });

        assert.throws(() => {
          instance.register(clientId, terminalStatement);
        }, /Attempted to register a terminal statement/);
      });
    });

    describe("deregister()", () => {
      it("should remove statement when last client deregisters", () => {
        instance.register(clientId, statement);
        instance.deregister(clientId, statement);

        assert.strictEqual(monitoredMap.size, 0);
        assert.strictEqual(instance.isEmpty(), true);
        assert.deepStrictEqual(instance.getAll(), []);
      });

      it("should leave statement with lower client count when other clients remain", () => {
        instance.register(clientId, statement);
        instance.register("otherClient", statement);
        assert.strictEqual(monitoredMap.size, 1);

        instance.deregister(clientId, statement);
        assert.strictEqual(monitoredMap.size, 1);
        const monitoredStatement = monitoredMap.get(statement.id);
        assert.ok(monitoredStatement);
        assert.strictEqual(monitoredStatement.clientIds.size, 1);
        assert.ok(monitoredStatement.clientIds.has("otherClient"));
      });

      it("should work with multiple statements", () => {
        const otherStatement = createFlinkStatement({
          name: "other",
          updatedAt: new Date("2024-01-02"),
        });
        instance.register(clientId, [statement, otherStatement]);
        assert.strictEqual(monitoredMap.size, 2);

        instance.deregister(clientId, [statement, otherStatement]);
        assert.strictEqual(monitoredMap.size, 0);
      });

      it("gracefully handle deregistering a statement not registered", () => {
        instance.deregister(clientId, createFlinkStatement({ name: "notRegistered" }));
        assert.strictEqual(monitoredMap.size, 0);
      });
    });

    describe("deregisterClient()", () => {
      it("should remove all statements for a clientId", () => {
        const otherStatement = createFlinkStatement({
          name: "other",
        });
        instance.register(clientId, [statement, otherStatement]);
        assert.strictEqual(monitoredMap.size, 2);
        assert.strictEqual(monitoredMap.get(statement.id)?.clientIds.size, 1);
        assert.strictEqual(monitoredMap.get(otherStatement.id)?.clientIds.size, 1);

        instance.deregisterClient(clientId);
        assert.strictEqual(monitoredMap.size, 0);
      });
      it("should not remove other clients' statements", () => {
        const otherClientId = "otherClient";
        const otherStatement = createFlinkStatement({
          name: "other",
        });
        instance.register(clientId, [statement, otherStatement]);
        instance.register(otherClientId, statement);
        assert.strictEqual(monitoredMap.size, 2);
        assert.strictEqual(monitoredMap.get(statement.id)?.clientIds.size, 2);
        assert.strictEqual(monitoredMap.get(otherStatement.id)?.clientIds.size, 1);

        instance.deregisterClient(clientId);
        assert.strictEqual(monitoredMap.size, 1);
        assert.strictEqual(monitoredMap.get(statement.id)?.clientIds.size, 1);
      });
    });

    describe("update()", () => {
      it("should update the statement if it is fresher", () => {
        const fresherStatement = createFlinkStatement({
          updatedAt: new Date("2024-01-02"),
        });

        instance.register(clientId, statement);
        const updated = instance.update(fresherStatement);
        assert.strictEqual(updated, true);

        assert.strictEqual(monitoredMap.size, 1);
        const monitoredStatement = monitoredMap.get(statement.id);
        assert.ok(monitoredStatement);
        assert.ok(monitoredStatement.statement === fresherStatement);
        assert.strictEqual(monitoredStatement.clientIds.size, 1);

        // Adding the fresher version should fire the event.
        sinon.assert.calledOnce(flinkStatementUpdatedFired);
        sinon.assert.calledWith(flinkStatementUpdatedFired, fresherStatement);
      });
      it("should not update the statement if it is not fresher", () => {
        const sameFreshnessStatement = createFlinkStatement({
          updatedAt: initialStatementDate,
        });

        instance.register(clientId, statement);
        const updated = instance.update(sameFreshnessStatement);
        assert.strictEqual(updated, false);

        assert.strictEqual(monitoredMap.size, 1);
        const monitoredStatement = monitoredMap.get(statement.id);
        assert.ok(monitoredStatement);
        // did not update the statement reference.
        assert.ok(monitoredStatement.statement === statement);
        assert.strictEqual(monitoredStatement.clientIds.size, 1);

        // Adding the fresher version should fire the event.
        sinon.assert.notCalled(flinkStatementUpdatedFired);
      });

      it("should remove the statement if it is terminal", () => {
        const terminalStatement = createFlinkStatement({
          phase: STOPPED_PHASE,
        });

        instance.register(clientId, statement);
        const updated = instance.update(terminalStatement);
        assert.strictEqual(updated, true);

        assert.strictEqual(monitoredMap.size, 0);
        // Adding the fresher version should fire the event.
        sinon.assert.calledOnce(flinkStatementUpdatedFired);
        sinon.assert.calledWith(flinkStatementUpdatedFired, terminalStatement);
      });
      it("should not update if the statement was not registered", () => {
        const updated = instance.update(statement);
        assert.strictEqual(updated, false);
        assert.strictEqual(monitoredMap.size, 0);
        sinon.assert.notCalled(flinkStatementUpdatedFired);
      });
    });

    describe("clear()", () => {
      it("should clear all monitored statements", () => {
        const otherStatement = createFlinkStatement({
          name: "other",
        });
        instance.register(clientId, [statement, otherStatement]);
        assert.strictEqual(monitoredMap.size, 2);

        instance.clear();
        instance.isEmpty();
        assert.strictEqual(monitoredMap.size, 0);
      });
    });
  });
});
