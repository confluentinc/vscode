import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { Uri } from "vscode";
import { getSidecarStub } from "../../tests/stubs/sidecar";
import { getStubbedCCloudResourceLoader } from "../../tests/stubs/resourceLoaders";
import {
  TEST_CCLOUD_ENVIRONMENT,
  TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
} from "../../tests/unit/testResources";
import { TEST_CCLOUD_FLINK_COMPUTE_POOL } from "../../tests/unit/testResources/flinkComputePool";
import {
  createFlinkStatement,
  TEST_CCLOUD_FLINK_STATEMENT,
} from "../../tests/unit/testResources/flinkStatement";
import { TEST_CCLOUD_ORGANIZATION_ID } from "../../tests/unit/testResources/organization";
import { createResponseError } from "../../tests/unit/testUtils";
import type {
  GetSqlv1Statement200Response,
  GetSqlv1StatementResult200Response,
} from "../clients/flinkSql";
import { StatementResultsSqlV1Api, StatementsSqlV1Api } from "../clients/flinkSql";
import { uriMetadataSet } from "../emitters";
import { FLINK_CONFIG_STATEMENT_PREFIX } from "../extensionSettings/constants";
import type { CCloudResourceLoader } from "../loaders";
import { Logger } from "../logging";
import * as flinkStatementModels from "../models/flinkStatement";
import { FlinkSpecProperties, FlinkStatement } from "../models/flinkStatement";
import type { EnvironmentId } from "../models/resource";
import type * as sidecar from "../sidecar";
import { UriMetadataKeys } from "../storage/constants";
import { getResourceManager } from "../storage/resourceManager";
import { localTimezoneOffset } from "../utils/timezone";
import { Operation } from "./flinkStatementResults";
import type { IFlinkStatementSubmitParameters } from "./statementUtils";
import {
  buildFlinkSelectQuery,
  determineFlinkStatementName,
  FlinkStatementWebviewPanelCache,
  isFromFlinkWorkspace,
  MAX_WAIT_TIME_MS,
  openFlinkQueryDocument,
  parseAllFlinkStatementResults,
  REFRESH_STATEMENT_MAX_WAIT_MS,
  refreshFlinkStatement,
  setFlinkDocumentMetadata,
  submitFlinkStatement,
  validateFlinkQueryResources,
  waitForResultsFetchable,
  waitForStatementCompletion,
} from "./statementUtils";

describe("flinkSql/statementUtils.ts", function () {
  let sandbox: sinon.SinonSandbox;

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

  describe("utils.refreshFlinkStatement", function () {
    let stubbedStatementsApi: sinon.SinonStubbedInstance<StatementsSqlV1Api>;
    let mockRouteResponse: GetSqlv1Statement200Response;
    let mockSidecar: sinon.SinonStubbedInstance<sidecar.SidecarHandle>;

    let clock: sinon.SinonFakeTimers;

    const requestStatement = createFlinkStatement({});

    beforeEach(function () {
      sandbox.useFakeTimers({ now: new Date() });
      clock = sandbox.clock;

      mockSidecar = getSidecarStub(sandbox);
      stubbedStatementsApi = sandbox.createStubInstance(StatementsSqlV1Api);
      mockSidecar.getFlinkSqlStatementsApi.returns(stubbedStatementsApi);

      mockRouteResponse = {
        status: { phase: "PENDING" },
        metadata: { created_at: new Date() },
      } as GetSqlv1Statement200Response;
      stubbedStatementsApi.getSqlv1Statement.resolves(mockRouteResponse);
    });

    afterEach(() => {
      clock.restore();
    });

    it("should return the statement if it exists", async function () {
      const statement = await refreshFlinkStatement(requestStatement);
      assert.ok(statement instanceof FlinkStatement);
      sinon.assert.calledOnce(stubbedStatementsApi.getSqlv1Statement);
    });

    it("should return null if the statement is not found", async function () {
      stubbedStatementsApi.getSqlv1Statement.rejects(createResponseError(404, "Not Found", "test"));

      const shouldBeNull = await refreshFlinkStatement(requestStatement);
      assert.strictEqual(shouldBeNull, null);

      sinon.assert.calledOnce(stubbedStatementsApi.getSqlv1Statement);
    });

    it("should throw an error if the statement is not completed after REFRESH_STATEMENT_MAX_WAIT_MS milliseconds", async function () {
      // wire up getSqlv1Statement to not resolve until REFRESH_STATEMENT_MAX_WAIT_MS * 2
      // this will force the timeout case.
      stubbedStatementsApi.getSqlv1Statement.callsFake(async () => {
        await clock.tickAsync(REFRESH_STATEMENT_MAX_WAIT_MS * 2);
        return mockRouteResponse;
      });

      // Start the promise
      const promise = refreshFlinkStatement(requestStatement);

      // Advance past the max wait time is reached.
      await clock.tickAsync(REFRESH_STATEMENT_MAX_WAIT_MS + 1);

      await assert.rejects(promise, /Timeout exceeded/);
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

  describe("isFromFlinkWorkspace()", function () {
    it("should return true when FLINK_FROM_WORKSPACE is true", function () {
      const metadata = { [UriMetadataKeys.FLINK_FROM_WORKSPACE]: true };
      assert.strictEqual(isFromFlinkWorkspace(metadata), true);
    });

    it("should return false when FLINK_FROM_WORKSPACE is false", function () {
      const metadata = { [UriMetadataKeys.FLINK_FROM_WORKSPACE]: false };
      assert.strictEqual(isFromFlinkWorkspace(metadata), false);
    });

    it("should return false when FLINK_FROM_WORKSPACE is absent", function () {
      const metadata = { [UriMetadataKeys.FLINK_COMPUTE_POOL_ID]: "pool-123" };
      assert.strictEqual(isFromFlinkWorkspace(metadata), false);
    });

    it("should return false when metadata is undefined", function () {
      assert.strictEqual(isFromFlinkWorkspace(undefined), false);
    });
  });

  describe("validateFlinkQueryResources()", function () {
    let stubbedCCloudResourceLoader: sinon.SinonStubbedInstance<CCloudResourceLoader>;
    let testLogger: Logger;

    beforeEach(() => {
      stubbedCCloudResourceLoader = getStubbedCCloudResourceLoader(sandbox);
      testLogger = new Logger("test");
      sandbox.stub(testLogger, "error");
    });

    it("should return all resources when validation succeeds", async function () {
      stubbedCCloudResourceLoader.getEnvironment.resolves(TEST_CCLOUD_ENVIRONMENT);
      stubbedCCloudResourceLoader.getFlinkDatabase.resolves(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER);

      const result = await validateFlinkQueryResources(
        {
          environmentId: "env-123" as EnvironmentId,
          databaseId: "lkc-456",
        },
        testLogger,
      );

      assert.strictEqual(result.environment, TEST_CCLOUD_ENVIRONMENT);
      assert.strictEqual(result.database, TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER);
      assert.strictEqual(result.computePool, TEST_CCLOUD_FLINK_COMPUTE_POOL);

      sinon.assert.calledOnceWithExactly(
        stubbedCCloudResourceLoader.getEnvironment,
        "env-123" as EnvironmentId,
      );
      sinon.assert.calledOnceWithExactly(
        stubbedCCloudResourceLoader.getFlinkDatabase,
        "env-123" as EnvironmentId,
        "lkc-456",
      );
    });

    it("should throw error when environment is not found", async function () {
      stubbedCCloudResourceLoader.getEnvironment.resolves(undefined);

      await assert.rejects(
        async () =>
          await validateFlinkQueryResources(
            {
              environmentId: "env-missing" as EnvironmentId,
              databaseId: "lkc-456",
            },
            testLogger,
          ),
        /environment "env-missing" could not be found/,
      );

      sinon.assert.calledOnceWithExactly(
        stubbedCCloudResourceLoader.getEnvironment,
        "env-missing" as EnvironmentId,
      );
      sinon.assert.notCalled(stubbedCCloudResourceLoader.getFlinkDatabase);
    });

    it("should throw error when database is not found", async function () {
      stubbedCCloudResourceLoader.getEnvironment.resolves(TEST_CCLOUD_ENVIRONMENT);
      stubbedCCloudResourceLoader.getFlinkDatabase.resolves(undefined);

      await assert.rejects(
        async () =>
          await validateFlinkQueryResources(
            {
              environmentId: "env-123" as EnvironmentId,
              databaseId: "lkc-missing",
            },
            testLogger,
          ),
        /database "lkc-missing" is not available or is not Flink-enabled/,
      );

      sinon.assert.calledOnceWithExactly(
        stubbedCCloudResourceLoader.getEnvironment,
        "env-123" as EnvironmentId,
      );
      sinon.assert.calledOnceWithExactly(
        stubbedCCloudResourceLoader.getFlinkDatabase,
        "env-123" as EnvironmentId,
        "lkc-missing",
      );
    });

    it("should throw error when no compute pool is available", async function () {
      stubbedCCloudResourceLoader.getEnvironment.resolves(TEST_CCLOUD_ENVIRONMENT);
      const databaseWithoutPools = {
        ...TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        flinkPools: [],
      } as any;
      stubbedCCloudResourceLoader.getFlinkDatabase.resolves(databaseWithoutPools);

      await assert.rejects(
        async () =>
          await validateFlinkQueryResources(
            {
              environmentId: "env-123" as EnvironmentId,
              databaseId: "lkc-no-pools",
            },
            testLogger,
          ),
        /no compute pool is configured for database/,
      );

      sinon.assert.calledOnceWithExactly(
        stubbedCCloudResourceLoader.getEnvironment,
        "env-123" as EnvironmentId,
      );
      sinon.assert.calledOnceWithExactly(
        stubbedCCloudResourceLoader.getFlinkDatabase,
        "env-123" as EnvironmentId,
        "lkc-no-pools",
      );
    });
  });

  describe("buildFlinkSelectQuery()", function () {
    it("should build fully-qualified query with default limit", function () {
      const query = buildFlinkSelectQuery(
        TEST_CCLOUD_ENVIRONMENT,
        TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        "pageviews",
      );

      const expected = `-- Query "pageviews" with Flink SQL
-- Replace this with your actual Flink SQL query

SELECT *
FROM \`${TEST_CCLOUD_ENVIRONMENT.name}\`.\`${TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.name}\`.\`pageviews\`
LIMIT 10;
`;
      assert.strictEqual(query, expected);
    });

    it("should build query with custom limit", function () {
      const query = buildFlinkSelectQuery(
        TEST_CCLOUD_ENVIRONMENT,
        TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        "orders",
        { limit: 50 },
      );

      assert.ok(query.includes("LIMIT 50;"));
    });

    it("should escape entity names with backticks", function () {
      const query = buildFlinkSelectQuery(
        TEST_CCLOUD_ENVIRONMENT,
        TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        "table-with-dashes",
      );

      assert.ok(query.includes("`table-with-dashes`"));
    });

    it("should include entity name in comment", function () {
      const query = buildFlinkSelectQuery(
        TEST_CCLOUD_ENVIRONMENT,
        TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        "my_topic",
      );

      assert.ok(query.includes('-- Query "my_topic" with Flink SQL'));
    });
  });

  describe("openFlinkQueryDocument()", function () {
    let openTextDocumentStub: sinon.SinonStub;
    let showTextDocumentStub: sinon.SinonStub;
    let setFlinkDocumentMetadataStub: sinon.SinonStub;

    beforeEach(() => {
      openTextDocumentStub = sandbox.stub(vscode.workspace, "openTextDocument");
      showTextDocumentStub = sandbox.stub(vscode.window, "showTextDocument");
      setFlinkDocumentMetadataStub = sandbox
        .stub(getResourceManager(), "setUriMetadata")
        .resolves();
      // Stub uriMetadataSet.fire to prevent side effects from listeners
      sandbox.stub(uriMetadataSet, "fire");
    });

    it("should create document with FlinkSQL language and fully-qualified query", async function () {
      const mockDocument = { uri: Uri.parse("untitled:Untitled-1"), positionAt: () => ({}) };
      const mockEditor = { selection: undefined };
      openTextDocumentStub.resolves(mockDocument);
      showTextDocumentStub.resolves(mockEditor);

      await openFlinkQueryDocument({
        entityName: "test_table",
        environment: TEST_CCLOUD_ENVIRONMENT,
        database: TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        computePool: TEST_CCLOUD_FLINK_COMPUTE_POOL,
      });

      // Verify our specific call (may be additional calls from listeners)
      const ourCall = openTextDocumentStub
        .getCalls()
        .find((call: any) => call.args[0]?.language === "flinksql");
      assert.ok(ourCall, "Expected openTextDocument to be called with language: 'flinksql'");

      const callArgs = ourCall.args[0];
      assert.strictEqual(callArgs.language, "flinksql");
      assert.ok(callArgs.content.includes('-- Query "test_table" with Flink SQL'));
      assert.ok(
        callArgs.content.includes(
          `\`${TEST_CCLOUD_ENVIRONMENT.name}\`.\`${TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.name}\`.\`test_table\``,
        ),
      );
      assert.ok(callArgs.content.includes("LIMIT 10;"));
    });

    it("should create query with custom limit when provided", async function () {
      const mockDocument = { uri: Uri.parse("untitled:Untitled-1"), positionAt: () => ({}) };
      const mockEditor = { selection: undefined };
      openTextDocumentStub.resolves(mockDocument);
      showTextDocumentStub.resolves(mockEditor);

      await openFlinkQueryDocument({
        entityName: "orders",
        environment: TEST_CCLOUD_ENVIRONMENT,
        database: TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        computePool: TEST_CCLOUD_FLINK_COMPUTE_POOL,
        limit: 50,
      });

      const callArgs = openTextDocumentStub.getCall(0).args[0];
      assert.ok(callArgs.content.includes("LIMIT 50;"));
    });

    it("should set Flink document metadata", async function () {
      const mockDocument = { uri: Uri.parse("untitled:Untitled-1"), positionAt: () => ({}) };
      const mockEditor = { selection: undefined };
      openTextDocumentStub.resolves(mockDocument);
      showTextDocumentStub.resolves(mockEditor);

      await openFlinkQueryDocument({
        entityName: "test_table",
        environment: TEST_CCLOUD_ENVIRONMENT,
        database: TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        computePool: TEST_CCLOUD_FLINK_COMPUTE_POOL,
      });

      sinon.assert.calledOnceWithExactly(setFlinkDocumentMetadataStub, mockDocument.uri, {
        [UriMetadataKeys.FLINK_CATALOG_ID]: TEST_CCLOUD_ENVIRONMENT.id,
        [UriMetadataKeys.FLINK_CATALOG_NAME]: TEST_CCLOUD_ENVIRONMENT.name,
        [UriMetadataKeys.FLINK_DATABASE_ID]: TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.id,
        [UriMetadataKeys.FLINK_DATABASE_NAME]: TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.name,
        [UriMetadataKeys.FLINK_COMPUTE_POOL_ID]: TEST_CCLOUD_FLINK_COMPUTE_POOL.id,
      });
    });

    it("should show document with preview false", async function () {
      const mockDocument = { uri: Uri.parse("untitled:Untitled-1"), positionAt: () => ({}) };
      const mockEditor = { selection: undefined };
      openTextDocumentStub.resolves(mockDocument);
      showTextDocumentStub.resolves(mockEditor);

      await openFlinkQueryDocument({
        entityName: "test_table",
        environment: TEST_CCLOUD_ENVIRONMENT,
        database: TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        computePool: TEST_CCLOUD_FLINK_COMPUTE_POOL,
      });

      sinon.assert.calledOnceWithExactly(showTextDocumentStub, mockDocument, { preview: false });
    });

    it("should position cursor at end when positionCursorAtEnd is true", async function () {
      const endPosition = new vscode.Position(1, 20);
      const mockDocument = {
        uri: Uri.parse("untitled:Untitled-1"),
        positionAt: sandbox.stub().returns(endPosition),
      };
      const mockEditor: any = { selection: undefined };
      openTextDocumentStub.resolves(mockDocument);
      showTextDocumentStub.resolves(mockEditor);

      await openFlinkQueryDocument({
        entityName: "test_table",
        environment: TEST_CCLOUD_ENVIRONMENT,
        database: TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        computePool: TEST_CCLOUD_FLINK_COMPUTE_POOL,
        positionCursorAtEnd: true,
      });

      sinon.assert.calledOnce(mockDocument.positionAt);
      assert.ok(mockEditor.selection);
      assert.strictEqual(mockEditor.selection.start.line, 1);
      assert.strictEqual(mockEditor.selection.start.character, 20);
    });

    it("should not reposition cursor when positionCursorAtEnd is false", async function () {
      const mockDocument = {
        uri: Uri.parse("untitled:Untitled-1"),
        positionAt: sandbox.stub(),
      };
      const mockEditor = { selection: undefined };
      openTextDocumentStub.resolves(mockDocument);
      showTextDocumentStub.resolves(mockEditor);

      await openFlinkQueryDocument({
        entityName: "test_table",
        environment: TEST_CCLOUD_ENVIRONMENT,
        database: TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        computePool: TEST_CCLOUD_FLINK_COMPUTE_POOL,
        positionCursorAtEnd: false,
      });

      sinon.assert.notCalled(mockDocument.positionAt);
      assert.strictEqual(mockEditor.selection, undefined);
    });
  });
});
