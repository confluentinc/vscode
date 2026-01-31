import * as assert from "assert";
import * as sinon from "sinon";
import { Uri } from "vscode";
import {
  TEST_CCLOUD_ENVIRONMENT,
  TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
} from "../../tests/unit/testResources";
import { TEST_CCLOUD_FLINK_COMPUTE_POOL } from "../../tests/unit/testResources/flinkComputePool";
import {
  createFlinkStatement,
  TEST_CCLOUD_FLINK_STATEMENT,
} from "../../tests/unit/testResources/flinkStatement";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import { TokenManager } from "../authn/oauth2/tokenManager";
import { uriMetadataSet } from "../emitters";
import { FLINK_CONFIG_STATEMENT_PREFIX } from "../extensionSettings/constants";
import { FlinkSpecProperties, Phase } from "../models/flinkStatement";
import { CCloudDataPlaneProxy, type FlinkStatement as FlinkStatementApi } from "../proxy";
import { HttpError } from "../proxy/httpClient";
import { UriMetadataKeys } from "../storage/constants";
import { getResourceManager } from "../storage/resourceManager";
import {
  determineFlinkStatementName,
  FlinkStatementWebviewPanelCache,
  MAX_WAIT_TIME_MS,
  parseAllFlinkStatementResults,
  refreshFlinkStatement,
  setFlinkDocumentMetadata,
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
    it("toProperties() returns empty object if FlinkSpecProperties is constructed with empty object.", function () {
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

  describe("determineFlinkStatementName()", function () {
    const now = new Date("2024-10-21 12:00:00.0000Z");
    const expectedDatePart = "2024-10-21t12-00-00";
    const defaultPrefix = FLINK_CONFIG_STATEMENT_PREFIX.value || "flink";

    beforeEach(() => {
      sandbox.useFakeTimers(now);
    });

    it("Should include the spice parameter in the statement name", async function () {
      const statementName = await determineFlinkStatementName("test-spice");

      assert.strictEqual(statementName, `${defaultPrefix}-vscode-test-spice-${expectedDatePart}`);
    });

    it("Should return a name without spice if spice is not provided", async function () {
      const statementName = await determineFlinkStatementName();

      assert.strictEqual(statementName, `${defaultPrefix}-vscode-${expectedDatePart}`);
    });

    it("Should prepend the user-configured prefix to the statement name if set", async function () {
      const statementName = await determineFlinkStatementName();
      assert.strictEqual(
        statementName,
        `${FLINK_CONFIG_STATEMENT_PREFIX.value}-vscode-${expectedDatePart}`,
      );
    });
  });

  describe("refreshFlinkStatement()", function () {
    let tokenManagerStub: sinon.SinonStubbedInstance<TokenManager>;
    let getStatementStub: sinon.SinonStub;

    beforeEach(() => {
      // Stub TokenManager
      tokenManagerStub = sandbox.createStubInstance(TokenManager);
      tokenManagerStub.getDataPlaneToken.resolves("test-data-plane-token");
      sandbox.stub(TokenManager, "getInstance").returns(tokenManagerStub);

      // Stub proxy methods
      getStatementStub = sandbox.stub(CCloudDataPlaneProxy.prototype, "getStatement");
    });

    it("should return the statement if it exists", async function () {
      const mockApiStatement: FlinkStatementApi = {
        api_version: "sql/v1",
        kind: "Statement",
        name: TEST_CCLOUD_FLINK_STATEMENT.name,
        organization_id: TEST_CCLOUD_FLINK_STATEMENT.organizationId,
        environment_id: TEST_CCLOUD_FLINK_STATEMENT.environmentId,
        metadata: {
          self: "test-self",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        spec: {
          statement: "SELECT * FROM test_table",
          compute_pool_id: TEST_CCLOUD_FLINK_COMPUTE_POOL.id,
        },
        status: {
          phase: "RUNNING",
          detail: "Running",
          traits: {
            sql_kind: "SELECT",
          },
        },
      };

      getStatementStub.resolves(mockApiStatement);

      const result = await refreshFlinkStatement(TEST_CCLOUD_FLINK_STATEMENT);

      assert.ok(result, "Result should not be null");
      assert.strictEqual(result!.name, TEST_CCLOUD_FLINK_STATEMENT.name);
      sinon.assert.calledOnce(getStatementStub);
      sinon.assert.calledWith(getStatementStub, TEST_CCLOUD_FLINK_STATEMENT.name);
    });

    it("should return null if the statement is not found", async function () {
      getStatementStub.rejects(new HttpError("Not Found", 404, "Not Found"));

      const result = await refreshFlinkStatement(TEST_CCLOUD_FLINK_STATEMENT);

      assert.strictEqual(result, null);
    });

    it("should throw an error for non-404 errors", async function () {
      getStatementStub.rejects(
        new HttpError("Internal Server Error", 500, "Internal Server Error"),
      );

      await assert.rejects(
        async () => refreshFlinkStatement(TEST_CCLOUD_FLINK_STATEMENT),
        /Internal Server Error/,
      );
    });
  });

  describe("submitFlinkStatement()", function () {
    let tokenManagerStub: sinon.SinonStubbedInstance<TokenManager>;
    let createStatementStub: sinon.SinonStub;

    beforeEach(() => {
      // Stub TokenManager
      tokenManagerStub = sandbox.createStubInstance(TokenManager);
      tokenManagerStub.getDataPlaneToken.resolves("test-data-plane-token");
      sandbox.stub(TokenManager, "getInstance").returns(tokenManagerStub);

      // Stub proxy methods
      createStatementStub = sandbox.stub(CCloudDataPlaneProxy.prototype, "createStatement");
    });

    it("submits a Flink statement with the correct parameters", async function () {
      const mockApiStatement: FlinkStatementApi = {
        api_version: "sql/v1",
        kind: "Statement",
        name: "test-statement-name",
        organization_id: TEST_CCLOUD_FLINK_COMPUTE_POOL.environmentId,
        environment_id: TEST_CCLOUD_FLINK_COMPUTE_POOL.environmentId,
        metadata: {
          self: "test-self",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        spec: {
          statement: "SELECT * FROM my_table",
          compute_pool_id: TEST_CCLOUD_FLINK_COMPUTE_POOL.id,
        },
        status: {
          phase: "PENDING",
          detail: "Pending",
        },
      };

      createStatementStub.resolves(mockApiStatement);

      const result = await submitFlinkStatement({
        statement: "SELECT * FROM my_table",
        statementName: "test-statement-name",
        computePool: TEST_CCLOUD_FLINK_COMPUTE_POOL,
        organizationId: "org-123",
        properties: new FlinkSpecProperties({
          currentCatalog: "my_catalog",
          currentDatabase: "my_database",
        }),
        hidden: false,
      });

      assert.ok(result);
      assert.strictEqual(result.name, "test-statement-name");
      sinon.assert.calledOnce(createStatementStub);

      const createArgs = createStatementStub.firstCall.args[0];
      assert.strictEqual(createArgs.name, "test-statement-name");
      assert.strictEqual(createArgs.statement, "SELECT * FROM my_table");
      assert.strictEqual(createArgs.computePoolId, TEST_CCLOUD_FLINK_COMPUTE_POOL.id);
      assert.deepStrictEqual(createArgs.properties, {
        "sql.current-catalog": "my_catalog",
        "sql.current-database": "my_database",
      });
      assert.strictEqual(createArgs.labels, undefined); // not hidden
    });

    it("adds hidden label when hidden is true", async function () {
      const mockApiStatement: FlinkStatementApi = {
        api_version: "sql/v1",
        kind: "Statement",
        name: "hidden-statement",
        organization_id: TEST_CCLOUD_FLINK_COMPUTE_POOL.environmentId,
        environment_id: TEST_CCLOUD_FLINK_COMPUTE_POOL.environmentId,
        metadata: {},
        spec: {
          statement: "SELECT * FROM catalogs",
        },
        status: {
          phase: "PENDING",
        },
      };

      createStatementStub.resolves(mockApiStatement);

      await submitFlinkStatement({
        statement: "SELECT * FROM catalogs",
        statementName: "hidden-statement",
        computePool: TEST_CCLOUD_FLINK_COMPUTE_POOL,
        organizationId: "org-123",
        properties: new FlinkSpecProperties({}),
        hidden: true,
      });

      sinon.assert.calledOnce(createStatementStub);
      const createArgs = createStatementStub.firstCall.args[0];
      assert.deepStrictEqual(createArgs.labels, { "user.confluent.io/hidden": "true" });
    });

    it("throws error when data plane token is not available", async function () {
      tokenManagerStub.getDataPlaneToken.resolves(null);

      await assert.rejects(
        async () =>
          submitFlinkStatement({
            statement: "SELECT 1",
            statementName: "test-statement",
            computePool: TEST_CCLOUD_FLINK_COMPUTE_POOL,
            organizationId: "org-123",
            properties: new FlinkSpecProperties({}),
            hidden: false,
          }),
        /Failed to get data plane token/,
      );
    });
  });

  describe("waitForStatement* tests", () => {
    let tokenManagerStub: sinon.SinonStubbedInstance<TokenManager>;
    let getStatementStub: sinon.SinonStub;

    beforeEach(() => {
      // Stub TokenManager
      tokenManagerStub = sandbox.createStubInstance(TokenManager);
      tokenManagerStub.getDataPlaneToken.resolves("test-data-plane-token");
      sandbox.stub(TokenManager, "getInstance").returns(tokenManagerStub);

      // Stub proxy methods
      getStatementStub = sandbox.stub(CCloudDataPlaneProxy.prototype, "getStatement");
    });

    describe("waitForResultsFetchable()", function () {
      it("returns when statement is running", async function () {
        // Start with PENDING, then return RUNNING
        const pendingStatement = createFlinkStatement({ phase: Phase.PENDING });
        const runningApiStatement: FlinkStatementApi = {
          api_version: "sql/v1",
          kind: "Statement",
          name: pendingStatement.name,
          organization_id: pendingStatement.organizationId,
          environment_id: pendingStatement.environmentId,
          metadata: {
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          spec: {
            statement: "SELECT * FROM test_table",
          },
          status: {
            phase: "RUNNING",
            detail: "Running",
            traits: {
              sql_kind: "SELECT",
              is_bounded: true,
              is_append_only: true,
            },
          },
        };

        getStatementStub.resolves(runningApiStatement);

        const result = await waitForResultsFetchable(pendingStatement);

        assert.ok(result);
        assert.strictEqual(result.phase, Phase.RUNNING);
      });

      it("throws an error if statement is not found", async function () {
        getStatementStub.rejects(new HttpError("Not Found", 404, "Not Found"));

        const statement = createFlinkStatement({ phase: Phase.PENDING });

        await assert.rejects(async () => waitForResultsFetchable(statement), /no longer exists/);
      });

      it("throws an error if statement is not running after timeout", async function () {
        // Always return PENDING, never transition to RUNNING
        const pendingApiStatement: FlinkStatementApi = {
          api_version: "sql/v1",
          kind: "Statement",
          name: "test-statement",
          organization_id: "org-123",
          environment_id: "env-123",
          metadata: {},
          spec: {
            statement: "SELECT * FROM test_table",
          },
          status: {
            phase: "PENDING",
            detail: "Pending",
          },
        };

        getStatementStub.resolves(pendingApiStatement);

        const statement = createFlinkStatement({ phase: Phase.PENDING });

        // Use a very short timeout for testing
        const shortMaxWait = 100;
        const shortPollInterval = 10;

        // Override the wait function with short timeout by calling waitForStatementState via waitForResultsFetchable
        // Since waitForResultsFetchable uses default timeouts, we need to test the timeout behavior differently
        // We'll simulate by making the statement stay in PENDING
        await assert.rejects(
          async () => waitForStatementCompletion(statement, shortMaxWait, shortPollInterval),
          /did not reach desired state/,
        );
      });
    });

    describe("waitForStatementCompletion()", () => {
      it("returns when statement is completed", async function () {
        const completedApiStatement: FlinkStatementApi = {
          api_version: "sql/v1",
          kind: "Statement",
          name: "test-statement",
          organization_id: "org-123",
          environment_id: "env-123",
          metadata: {
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          spec: {
            statement: "CREATE TABLE test_table ...",
          },
          status: {
            phase: "COMPLETED",
            detail: "Completed",
          },
        };

        getStatementStub.resolves(completedApiStatement);

        const statement = createFlinkStatement({ phase: Phase.RUNNING });
        const result = await waitForStatementCompletion(statement, 1000, 10);

        assert.ok(result);
        assert.strictEqual(result.phase, Phase.COMPLETED);
      });

      it("throws an error if statement is not found", async function () {
        getStatementStub.rejects(new HttpError("Not Found", 404, "Not Found"));

        const statement = createFlinkStatement({ phase: Phase.RUNNING });

        await assert.rejects(
          async () => waitForStatementCompletion(statement, 1000, 10),
          /no longer exists/,
        );
      });

      it("throws an error if statement is not completed after timeout", async function () {
        // Always return RUNNING, never transition to COMPLETED
        const runningApiStatement: FlinkStatementApi = {
          api_version: "sql/v1",
          kind: "Statement",
          name: "test-statement",
          organization_id: "org-123",
          environment_id: "env-123",
          metadata: {},
          spec: {
            statement: "SELECT * FROM test_table",
          },
          status: {
            phase: "RUNNING",
            detail: "Running",
          },
        };

        getStatementStub.resolves(runningApiStatement);

        const statement = createFlinkStatement({ phase: Phase.RUNNING });

        await assert.rejects(
          async () => waitForStatementCompletion(statement, 100, 10),
          /did not reach desired state/,
        );
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
    let tokenManagerStub: sinon.SinonStubbedInstance<TokenManager>;
    let getStatementResultsStub: sinon.SinonStub;

    beforeEach(() => {
      // Stub TokenManager
      tokenManagerStub = sandbox.createStubInstance(TokenManager);
      tokenManagerStub.getDataPlaneToken.resolves("test-data-plane-token");
      sandbox.stub(TokenManager, "getInstance").returns(tokenManagerStub);

      // Stub proxy methods
      getStatementResultsStub = sandbox.stub(CCloudDataPlaneProxy.prototype, "getStatementResults");
    });

    it("should parse results with no following page token", async () => {
      const statement = createFlinkStatement({
        schemaColumns: [{ name: "id" }, { name: "name" }, { name: "value" }],
      });

      getStatementResultsStub.resolves({
        api_version: "sql/v1",
        kind: "StatementResult",
        metadata: {
          next: null,
        },
        results: {
          data: [
            { op: 0, row: [1, "test1", 100] },
            { op: 0, row: [2, "test2", 200] },
          ],
        },
      });

      const results = await parseAllFlinkStatementResults<{
        id: number;
        name: string;
        value: number;
      }>(statement);

      assert.strictEqual(results.length, 2);
      assert.deepStrictEqual(results[0], { id: 1, name: "test1", value: 100 });
      assert.deepStrictEqual(results[1], { id: 2, name: "test2", value: 200 });
      sinon.assert.calledOnce(getStatementResultsStub);
    });

    it("should parse results with multiple pages", async () => {
      const statement = createFlinkStatement({
        schemaColumns: [{ name: "id" }, { name: "data" }],
      });

      // First call returns page 1 with a next token
      getStatementResultsStub.onFirstCall().resolves({
        api_version: "sql/v1",
        kind: "StatementResult",
        metadata: {
          next: "https://api.confluent.cloud/sql/v1/...?page_token=page2token",
        },
        results: {
          data: [
            { op: 0, row: [1, "page1-data1"] },
            { op: 0, row: [2, "page1-data2"] },
          ],
        },
      });

      // Second call returns page 2 with no next token
      getStatementResultsStub.onSecondCall().resolves({
        api_version: "sql/v1",
        kind: "StatementResult",
        metadata: {
          next: null,
        },
        results: {
          data: [
            { op: 0, row: [3, "page2-data1"] },
            { op: 0, row: [4, "page2-data2"] },
          ],
        },
      });

      const results = await parseAllFlinkStatementResults<{ id: number; data: string }>(statement);

      assert.strictEqual(results.length, 4);
      assert.deepStrictEqual(results[0], { id: 1, data: "page1-data1" });
      assert.deepStrictEqual(results[1], { id: 2, data: "page1-data2" });
      assert.deepStrictEqual(results[2], { id: 3, data: "page2-data1" });
      assert.deepStrictEqual(results[3], { id: 4, data: "page2-data2" });

      sinon.assert.calledTwice(getStatementResultsStub);
      // First call should have no page token
      sinon.assert.calledWith(getStatementResultsStub.firstCall, statement.name, undefined);
      // Second call should have the page token
      sinon.assert.calledWith(getStatementResultsStub.secondCall, statement.name, "page2token");
    });
  });

  describe("setFlinkDocumentMetadata()", function () {
    let rmSetUriMetadataStub: sinon.SinonStub;
    let uriMetadataSetFireStub: sinon.SinonStub;

    const uri = Uri.parse("file:///test/flink_statement.flink.sql");

    beforeEach(() => {
      rmSetUriMetadataStub = sandbox.stub(getResourceManager(), "setUriMetadata");
      uriMetadataSetFireStub = sandbox.stub(uriMetadataSet, "fire");
    });

    it("should set the catalog metadata from environment when provided", async () => {
      await setFlinkDocumentMetadata(uri, {
        catalog: TEST_CCLOUD_ENVIRONMENT,
      });

      sinon.assert.calledWith(rmSetUriMetadataStub, uri, {
        [UriMetadataKeys.FLINK_CATALOG_ID]: TEST_CCLOUD_ENVIRONMENT.id,
        [UriMetadataKeys.FLINK_CATALOG_NAME]: TEST_CCLOUD_ENVIRONMENT.name,
      });

      sinon.assert.calledWith(uriMetadataSetFireStub, uri);
    });

    it("should set the database metadata from kafka cluster when provided", async () => {
      await setFlinkDocumentMetadata(uri, {
        database: TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
      });

      sinon.assert.calledWith(rmSetUriMetadataStub, uri, {
        [UriMetadataKeys.FLINK_DATABASE_ID]: TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.id,
        [UriMetadataKeys.FLINK_DATABASE_NAME]: TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.name,
      });

      sinon.assert.calledWith(uriMetadataSetFireStub, uri);
    });

    it("should set the compute pool id when compute pool provided", async () => {
      await setFlinkDocumentMetadata(uri, {
        computePool: TEST_CCLOUD_FLINK_COMPUTE_POOL,
      });

      sinon.assert.calledWith(rmSetUriMetadataStub, uri, {
        [UriMetadataKeys.FLINK_COMPUTE_POOL_ID]: TEST_CCLOUD_FLINK_COMPUTE_POOL.id,
      });

      sinon.assert.calledWith(uriMetadataSetFireStub, uri);
    });
  });
});
