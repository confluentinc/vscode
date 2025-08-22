import * as assert from "assert";
import * as sinon from "sinon";
import { getSidecarStub } from "../../../tests/stubs/sidecar";
import { TEST_CCLOUD_FLINK_COMPUTE_POOL } from "../../../tests/unit/testResources/flinkComputePool";
import { TEST_CCLOUD_FLINK_STATEMENT } from "../../../tests/unit/testResources/flinkStatement";
import * as authnUtils from "../../authn/utils";
import { CCloudResourceLoader } from "../../loaders";
import * as flinkStatementModels from "../../models/flinkStatement";
import { FlinkStatement } from "../../models/flinkStatement";
import * as sidecar from "../../sidecar";
import {
  FlinkSpecProperties,
  FlinkStatementWebviewPanelCache,
  IFlinkStatementSubmitParameters,
  MAX_WAIT_TIME_MS,
  determineFlinkStatementName,
  localTimezoneOffset,
  submitFlinkStatement,
  waitForResultsFetchable,
  waitForStatementCompletion,
} from "./flinkStatements";

describe("commands/utils/flinkStatements.ts", function () {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("FlinkSpecProperties", function () {
    it("toProperties is delicate", function () {
      const properties = new FlinkSpecProperties({});
      assert.deepStrictEqual(properties.toProperties(), {});
    });

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

  describe("localTimezoneOffset()", function () {
    let originalTimezone: string | undefined;

    beforeEach(() => {
      originalTimezone = process.env.TZ;
    });
    afterEach(() => {
      if (originalTimezone) {
        process.env.TZ = originalTimezone;
      } else {
        delete process.env.TZ;
      }
    });

    it("Should extract offset relative to GMT", async function () {
      // Pin down timezone. May still be DST or not though based on the datetime.
      // (Can only do this once; internals of Date will cache the timezone offset?)
      process.env.TZ = "America/Los_Angeles";

      // This should be GMT-0700 for PDT or GMT-0800 for PST
      const offset = localTimezoneOffset();
      assert.strictEqual(offset.startsWith("GMT"), true, "Offset should end with GMT");
      // Fourth character should be + or -
      assert.strictEqual(offset[3] === "+" || offset[3] === "-", true, "Offset should be + or -");

      // Remainder will be either 0700 or 0800
      assert.strictEqual(
        offset.slice(4, 6) === "07" || offset.slice(4, 6) === "08",
        true,
        "Offset should be 0700 or 0800",
      );
      assert.strictEqual(offset.slice(6, 8) === "00", true, "Offset should be 00");
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
    let getOrganizationStub: sinon.SinonStub;

    beforeEach(() => {
      mockSidecar = getSidecarStub(sandbox);

      const ccloudLoader: CCloudResourceLoader = CCloudResourceLoader.getInstance();
      getOrganizationStub = sandbox.stub(ccloudLoader, "getOrganization");
    });

    it("Raises an error if no organization is found", async function () {
      getOrganizationStub.resolves(undefined);
      await assert.rejects(async () => {
        await submitFlinkStatement({} as IFlinkStatementSubmitParameters);
      }, /User must be signed in to Confluent Cloud to submit Flink statements/);
    });

    for (const hidden of [false, true]) {
      it(`Submits a Flink statement with the correct parameters: hidden ${hidden}`, async function () {
        getOrganizationStub.resolves({ id: "org-123", name: "Test Org" });

        const params: IFlinkStatementSubmitParameters = {
          statement: "SELECT * FROM my_table",
          statementName: "test-statement",
          computePool: TEST_CCLOUD_FLINK_COMPUTE_POOL,
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

  describe("waitForStatement* tests", function () {
    let refreshFlinkStatementStub: sinon.SinonStub;
    this.beforeEach(function () {
      sandbox.useFakeTimers(new Date());

      const ccloudLoader = CCloudResourceLoader.getInstance();
      refreshFlinkStatementStub = sandbox.stub(ccloudLoader, "refreshFlinkStatement");
    });

    describe("waitForResultsFetchable()", function () {
      it("returns when statement is running", async function () {
        refreshFlinkStatementStub.resolves({
          canRequestResults: true,
        });

        await waitForResultsFetchable(TEST_CCLOUD_FLINK_STATEMENT);
        sinon.assert.calledOnce(refreshFlinkStatementStub);
      });

      it("throws an error if statement is not found", async function () {
        refreshFlinkStatementStub.resolves(null);

        await assert.rejects(
          waitForResultsFetchable(TEST_CCLOUD_FLINK_STATEMENT),
          /no longer exists/,
        );
      });

      it("throws an error if statement is not running after MAX_WAIT_TIME_MS seconds", async function () {
        refreshFlinkStatementStub.resolves({
          canRequestResults: false,
        });

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
        refreshFlinkStatementStub.resolves({
          isCompleted: true,
        });

        await waitForStatementCompletion(TEST_CCLOUD_FLINK_STATEMENT);
        sinon.assert.calledOnce(refreshFlinkStatementStub);
      });

      it("throws an error if statement is not found", async function () {
        refreshFlinkStatementStub.resolves(null);

        await assert.rejects(
          waitForStatementCompletion(TEST_CCLOUD_FLINK_STATEMENT),
          /no longer exists/,
        );
      });

      it("throws an error if statement is not completed after MAX_WAIT_TIME_MS seconds", async function () {
        refreshFlinkStatementStub.resolves({
          isCompleted: false,
        });

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
});
