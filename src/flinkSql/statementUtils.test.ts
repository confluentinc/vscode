import * as assert from "assert";
import * as sinon from "sinon";
import { getSidecarStub } from "../../tests/stubs/sidecar";
import { TEST_CCLOUD_FLINK_COMPUTE_POOL } from "../../tests/unit/testResources/flinkComputePool";
import {
  createFlinkStatement,
  TEST_CCLOUD_FLINK_STATEMENT,
} from "../../tests/unit/testResources/flinkStatement";
import { TEST_CCLOUD_ORGANIZATION_ID } from "../../tests/unit/testResources/organization";
import { createResponseError, getTestExtensionContext } from "../../tests/unit/testUtils";
import * as authnUtils from "../authn/utils";
import {
  GetSqlv1Statement200Response,
  GetSqlv1StatementResult200Response,
  StatementResultsSqlV1Api,
  StatementsSqlV1Api,
} from "../clients/flinkSql";
import * as flinkStatementModels from "../models/flinkStatement";
import { FlinkSpecProperties, FlinkStatement } from "../models/flinkStatement";
import * as sidecar from "../sidecar";
import { Operation } from "../utils/flinkStatementResults";
import { localTimezoneOffset } from "../utils/timezone";
import {
  determineFlinkStatementName,
  FlinkStatementWebviewPanelCache,
  IFlinkStatementSubmitParameters,
  MAX_WAIT_TIME_MS,
  parseAllFlinkStatementResults,
  submitFlinkStatement,
  waitForResultsFetchable,
  waitForStatementCompletion,
} from "./statementUtils";

describe("flinkSql/statementUtils.ts", function () {
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

  describe("FlinkSpecProperties", function () {
    it("toProperties returns properties with currentCatalog and currentDatabase", function () {
      const properties = new FlinkSpecProperties({
        currentCatalog: "my_catalog",
        currentDatabase: "my_database",
      });
      assert.deepStrictEqual(properties.toProperties(), {
        "sql.current-catalog": "my_catalog",
        "sql.current-database": "my_database",
      });
    });

    it("union() merges properties preferring from other first", function () {
      // only with timezone
      const properties1 = new FlinkSpecProperties({
        currentCatalog: "my_catalog", // will be exposed.
        localTimezone: "GMT-0700", // will be occluded
      });
      const properties2 = new FlinkSpecProperties({
        currentDatabase: "my_database", // will be preferred.
        localTimezone: "GMT-0900", // will be preferred.
      });

      const merged = properties1.union(properties2);
      assert.deepStrictEqual(
        merged,
        new FlinkSpecProperties({
          localTimezone: "GMT-0900",
          currentCatalog: "my_catalog",
          currentDatabase: "my_database",
        }),
      );
    });
  });

  describe("determineFlinkStatementName()", function () {
    let getCCloudAuthSessionStub: sinon.SinonStub;

    const now = new Date("2024-10-21 12:00:00.0000Z");
    const expectedDatePart = "2024-10-21t12-00-00";

    beforeEach(() => {
      getCCloudAuthSessionStub = sandbox.stub(authnUtils, "getCCloudAuthSession");
      sandbox.useFakeTimers(now);
    });

    it("Should remove all non-alphanumeric characters (except for hyphens) from the username", async function () {
      getCCloudAuthSessionStub.resolves({
        account: {
          label: "VS_Code.Dev-Team@confluent.io",
          id: "u-abc123",
        },
      });

      const statementName = await determineFlinkStatementName();
      assert.strictEqual(statementName, `vscodedev-team-vscode-${expectedDatePart}`);
    });

    it("Works with degenerate ccloud username", async function () {
      getCCloudAuthSessionStub.resolves({ account: { label: "simple", id: "u-abc123" } });

      const statementName = await determineFlinkStatementName();
      assert.strictEqual(statementName, `simple-vscode-${expectedDatePart}`);
    });

    it("Handles crazy case if ccloud isn't authenticated", async function () {
      getCCloudAuthSessionStub.resolves(undefined);
      const statementName = await determineFlinkStatementName();
      assert.strictEqual(statementName, `unknownuser-vscode-${expectedDatePart}`);
    });

    it("Should remove leading numeric characters from the username", async function () {
      getCCloudAuthSessionStub.resolves({
        account: {
          label: "42_VS_Code.Devs-42@confluent.io",
          id: "u-abc123",
        },
      });

      const statementName = await determineFlinkStatementName();
      assert.strictEqual(statementName, `vscodedevs-42-vscode-${expectedDatePart}`);
    });

    it("Should remove leading hyphens from the username", async function () {
      getCCloudAuthSessionStub.resolves({
        account: {
          // I don't think this is a valid email address, but we should still trim
          // the leading hyphen from the statement name.
          label: "-vscode-devs@confluent.io",
          id: "u-abc123",
        },
      });

      const statementName = await determineFlinkStatementName();
      assert.strictEqual(statementName, `vscode-devs-vscode-${expectedDatePart}`);
    });
  });

  describe("submitFlinkStatement()", function () {
    let mockSidecar: sinon.SinonStubbedInstance<sidecar.SidecarHandle>;

    beforeEach(() => {
      mockSidecar = getSidecarStub(sandbox);
    });

    for (const hidden of [false, true]) {
      it(`Submits a Flink statement with the correct parameters: hidden ${hidden}`, async function () {
        const params: IFlinkStatementSubmitParameters = {
          statement: "SELECT * FROM my_table",
          statementName: "test-statement",
          computePool: TEST_CCLOUD_FLINK_COMPUTE_POOL,
          organizationId: TEST_CCLOUD_ORGANIZATION_ID,
          hidden: hidden,
          properties: FlinkSpecProperties.fromProperties({
            "sql.current-catalog": "my_catalog",
            "sql.current-database": "my_database",
            "sql.local-time-zone": localTimezoneOffset(),
          }),
        };

        const createSqlv1StatementStub = sandbox.stub().resolves(TEST_CCLOUD_FLINK_STATEMENT);
        const restFlinkStatementToModelStub = sandbox
          .stub(flinkStatementModels, "restFlinkStatementToModel")
          .returns(TEST_CCLOUD_FLINK_STATEMENT);

        const mockStatementsApi = {
          createSqlv1Statement: createSqlv1StatementStub,
        };
        // Not quite the right return type, but submitFlinkStatement returns
        // whatever this returns.
        mockSidecar.getFlinkSqlStatementsApi.returns(mockStatementsApi as any);

        const statement: FlinkStatement = await submitFlinkStatement(params);

        assert.deepStrictEqual(statement, TEST_CCLOUD_FLINK_STATEMENT);

        sinon.assert.calledOnce(createSqlv1StatementStub);
        sinon.assert.calledWith(
          createSqlv1StatementStub,
          sinon.match({
            CreateSqlv1StatementRequest: sinon.match({
              metadata: hidden ? { labels: { "user.confluent.io/hidden": "true" } } : undefined,
            }),
          }),
        );

        sinon.assert.calledWith(
          mockSidecar.getFlinkSqlStatementsApi,
          TEST_CCLOUD_FLINK_COMPUTE_POOL,
        );
        sinon.assert.calledWith(
          restFlinkStatementToModelStub,
          TEST_CCLOUD_FLINK_STATEMENT,
          TEST_CCLOUD_FLINK_COMPUTE_POOL,
        );
      });
    }
  });

  describe("waitForStatement* tests", () => {
    let stubbedStatementsApi: sinon.SinonStubbedInstance<StatementsSqlV1Api>;
    let mockRouteResponse: GetSqlv1Statement200Response;

    beforeEach(function () {
      sandbox.useFakeTimers({ now: new Date() });

      const stubbedSidecarHandle = getSidecarStub(sandbox);
      stubbedStatementsApi = sandbox.createStubInstance(StatementsSqlV1Api);
      stubbedSidecarHandle.getFlinkSqlStatementsApi.returns(stubbedStatementsApi);

      mockRouteResponse = {
        status: { phase: "PENDING" },
        metadata: { created_at: new Date() },
      } as GetSqlv1Statement200Response;
      stubbedStatementsApi.getSqlv1Statement.resolves(mockRouteResponse);
    });

    function setReturnedStatementPhase(phase: string) {
      // @ts-expect-error overwriting read-only member for testing
      mockRouteResponse.status.phase = phase;
    }

    describe("waitForResultsFetchable()", function () {
      it("returns when statement is running", async function () {
        setReturnedStatementPhase("RUNNING");
        await waitForResultsFetchable(TEST_CCLOUD_FLINK_STATEMENT);
        sinon.assert.calledOnce(stubbedStatementsApi.getSqlv1Statement);
      });

      it("throws an error if statement is not found", async function () {
        stubbedStatementsApi.getSqlv1Statement.rejects(
          createResponseError(404, "Not Found", "test"),
        );

        await assert.rejects(
          waitForResultsFetchable(TEST_CCLOUD_FLINK_STATEMENT),
          /no longer exists/,
        );
      });

      it("throws an error if statement is not running after MAX_WAIT_TIME_MS seconds", async function () {
        setReturnedStatementPhase("FAILING");

        const clock = sandbox.clock;

        // Start the promise
        const promise = waitForResultsFetchable(TEST_CCLOUD_FLINK_STATEMENT);

        // Advance past the max wait time is reached.
        await clock.tickAsync(MAX_WAIT_TIME_MS + 1);

        await assert.rejects(promise, /did not reach desired state/);
      });
    });

    describe("waitForStatementCompletion()", () => {
      it("returns when statement is completed", async function () {
        setReturnedStatementPhase("COMPLETED");

        await waitForStatementCompletion(TEST_CCLOUD_FLINK_STATEMENT);
        sinon.assert.calledOnce(stubbedStatementsApi.getSqlv1Statement);
      });

      it("throws an error if statement is not found", async function () {
        stubbedStatementsApi.getSqlv1Statement.rejects(
          createResponseError(404, "Not Found", "test"),
        );

        await assert.rejects(
          waitForResultsFetchable(TEST_CCLOUD_FLINK_STATEMENT),
          /no longer exists/,
        );
      });

      it("throws an error if statement is not completed after MAX_WAIT_TIME_MS seconds", async function () {
        setReturnedStatementPhase(flinkStatementModels.Phase.RUNNING);

        const clock = sandbox.clock;

        // Start the promise
        const promise = waitForStatementCompletion(TEST_CCLOUD_FLINK_STATEMENT);

        // Advance past the max wait time is reached.
        await clock.tickAsync(MAX_WAIT_TIME_MS + 1);

        await assert.rejects(promise, /did not reach desired state/);
      });
    });
  });

  describe("FlinkStatementWebviewPanelCache", function () {
    it("getPanelForStatement() should downcall into findOrCreate()", async function () {
      const instance = new FlinkStatementWebviewPanelCache();
      const findOrCreateStub = sandbox.stub(instance, "findOrCreate");

      await instance.getPanelForStatement(TEST_CCLOUD_FLINK_STATEMENT);

      assert.strictEqual(findOrCreateStub.calledOnce, true, "findOrCreate should be called once");
    });
  });

  describe("parseAllFlinkStatementResults()", () => {
    // Set up a FlinkStatement with a schema to request results for ...
    let statement: flinkStatementModels.FlinkStatement;

    // and then set up the stubbed API to return results for it.
    let stubbedResultsApi: sinon.SinonStubbedInstance<StatementResultsSqlV1Api>;

    interface TestQueryRow {
      col1: string;
      col2: number | null;
    }

    beforeEach(function () {
      sandbox.useFakeTimers({ now: new Date() });

      const stubbedSidecarHandle = getSidecarStub(sandbox);
      stubbedResultsApi = sandbox.createStubInstance(StatementResultsSqlV1Api);
      stubbedSidecarHandle.getFlinkSqlStatementResultsApi.returns(stubbedResultsApi);

      // Set up the statement to query for results from.
      statement = createFlinkStatement({
        schemaColumns: [
          { name: "label", type: { type: "STRING", nullable: false } },
          { name: "count", type: { type: "INT", nullable: true } },
        ],
        appendOnly: true,
        upsertColumns: [0],
      });
    });

    it("should parse results with no following page token", async () => {
      const singlePageRouteResponse = {
        results: {
          data: [
            { op: Operation.Insert, row: ["value1", 123] },
            { op: Operation.Insert, row: ["value2", 456] },
            { op: Operation.Insert, row: ["value3", 789] },
          ],
        },
      } as GetSqlv1StatementResult200Response;

      stubbedResultsApi.getSqlv1StatementResult.resolves(singlePageRouteResponse);

      const results = await parseAllFlinkStatementResults<TestQueryRow>(statement);

      assert.deepStrictEqual(results, [
        { label: "value1", count: 123 },
        { label: "value2", count: 456 },
        { label: "value3", count: 789 },
      ]);
    });

    it("should parse results with multiple pages", async () => {
      const firstPageRouteResponse = {
        results: {
          data: [
            { op: Operation.Insert, row: ["foo", 123] },
            { op: Operation.Insert, row: ["bar", 456] },
          ],
        },
        metadata: { next: "https://localhost/?page_token=token123" },
      } as GetSqlv1StatementResult200Response;

      const secondPageRouteResponse = {
        results: {
          data: [{ op: Operation.Insert, row: ["blat", 890] }],
        },
      } as GetSqlv1StatementResult200Response;

      stubbedResultsApi.getSqlv1StatementResult.onFirstCall().resolves(firstPageRouteResponse);
      stubbedResultsApi.getSqlv1StatementResult.onSecondCall().resolves(secondPageRouteResponse);

      const results = await parseAllFlinkStatementResults<TestQueryRow>(statement);

      assert.deepStrictEqual(results, [
        { label: "foo", count: 123 },
        { label: "bar", count: 456 },
        { label: "blat", count: 890 },
      ]);

      sinon.assert.calledTwice(stubbedResultsApi.getSqlv1StatementResult);
    });
  });
});
