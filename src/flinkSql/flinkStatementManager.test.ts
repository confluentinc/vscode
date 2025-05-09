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
        assert.strictEqual(monitoredMap.size, 1);
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
  });
});
