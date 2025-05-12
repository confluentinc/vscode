import * as assert from "assert";
import * as sinon from "sinon";
import { createFlinkStatement } from "../../tests/unit/testResources/flinkStatement";
import { flinkStatementUpdated } from "../emitters";
import { FlinkStatement, FlinkStatementId, STOPPED_PHASE } from "../models/flinkStatement";
import { MonitoredStatement, MonitoredStatements } from "./flinkStatementManager";

describe("flinkStatementManager.ts", () => {
  describe("MonitoredStatement", () => {
    const initialClientId = "testClientId";
    const initialStatementDate = new Date("2024-01-01");
    let statement: FlinkStatement;

    let monitoredStatement: MonitoredStatement;
    let clientIds: Set<string>;

    beforeEach(() => {
      statement = createFlinkStatement({ updatedAt: initialStatementDate });
      monitoredStatement = new MonitoredStatement(initialClientId, statement);
      clientIds = monitoredStatement["clientIds"];
    });

    describe("addClientId", () => {
      it("should add a clientId to the statement", () => {
        monitoredStatement.addClientId("newClient");
        assert.strictEqual(clientIds.size, 2);
        assert.ok(clientIds.has(initialClientId));
        assert.ok(clientIds.has("newClient"));
      });
    });

    describe("removeClientId", () => {
      it("should remove and indicate remaining count", () => {
        monitoredStatement.addClientId("newClient");
        assert.strictEqual(clientIds.size, 2);

        const remainingCount = monitoredStatement.removeClientId(initialClientId);
        assert.strictEqual(remainingCount, 1);
        assert.ok(clientIds.has("newClient"));

        // Remove the last clientId
        assert.strictEqual(monitoredStatement.removeClientId("newClient"), 0);
        assert.strictEqual(clientIds.size, 0);
      });
    });

    describe("maybeUpdateStatement", () => {
      it("Should update the statement if is fresher", () => {
        const fresherStatement = createFlinkStatement({ updatedAt: new Date("2024-01-02") });
        const updated = monitoredStatement.maybeUpdateStatement(fresherStatement);
        assert.strictEqual(updated, true);
        // Updated reference.
        assert.ok(monitoredStatement.statement === fresherStatement);
      });

      it("Should not update the statement if not fresher", () => {
        const sameFreshnessStatement = createFlinkStatement({ updatedAt: initialStatementDate });
        const updated = monitoredStatement.maybeUpdateStatement(sameFreshnessStatement);
        assert.strictEqual(updated, false);
        // Kept existing reference.
        assert.ok(monitoredStatement.statement === statement);
      });
    });
  });

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
