import * as assert from "assert";
import { ObservableScope } from "inertial";
import sinon from "sinon";
import { StatementResultsSqlV1Api, StatementsSqlV1Api } from "../src/clients/flinkSql";
import { FlinkStatementResultsManager } from "../src/flinkStatementResultsManager";
import { CCloudResourceLoader } from "../src/loaders/ccloudResourceLoader";
import { FlinkStatement } from "../src/models/flinkStatement";
import * as sidecar from "../src/sidecar";
import { DEFAULT_RESULTS_LIMIT } from "../src/utils/flinkStatementResults";
import { eventually } from "./eventually";
import { loadFixture } from "./fixtures/utils";

export interface FlinkStatementResultsManagerTestContext {
  manager: FlinkStatementResultsManager;
  flinkSqlStatementsApi: sinon.SinonStubbedInstance<StatementsSqlV1Api>;
  flinkSqlStatementResultsApi: sinon.SinonStubbedInstance<StatementResultsSqlV1Api>;
  sidecar: sinon.SinonStubbedInstance<sidecar.SidecarHandle>;
  statement: FlinkStatement;
  refreshFlinkStatementStub: sinon.SinonStub;
  notifyUIStub: sinon.SinonStub;
  resourceLoader: CCloudResourceLoader;
  sandbox: sinon.SinonSandbox;
}

/**
 * Creates a FlinkStatementResultsManager instance pre-loaded with WeatherData fixture results for testing.
 *
 * This helper loads a sequence of 5 fixture files containing statement results and configures the manager
 * to process them.
 *
 * The manager is set up with:
 * - A polling interval of 0 for immediate testing
 * - A refresh interval of 100ms
 * - Mock APIs that return the fixture data
 * - Stubs for refreshing statement status
 *
 * After initialization, the manager will have processed 10 total result rows that can be retrieved
 * via GetResults/GetResultsCount messages.
 *
 * @returns Initialized FlinkStatementResultsManager with processed results
 */

export async function createTestResultsManagerContext(
  sandbox = sinon.createSandbox(),
  os = ObservableScope(),
): Promise<FlinkStatementResultsManagerTestContext> {
  // Create sidecar and API mocks
  const mockSidecar = sandbox.createStubInstance(sidecar.SidecarHandle);
  sandbox.stub(sidecar, "getSidecar").resolves(mockSidecar);

  const flinkSqlStatementsApi = sandbox.createStubInstance(StatementsSqlV1Api);
  mockSidecar.getFlinkSqlStatementsApi.returns(flinkSqlStatementsApi);

  const flinkSqlStatementResultsApi = sandbox.createStubInstance(StatementResultsSqlV1Api);
  mockSidecar.getFlinkSqlStatementResultsApi.returns(flinkSqlStatementResultsApi);

  // Create resource loader and statement mocks
  const resourceLoader = CCloudResourceLoader.getInstance();
  const refreshFlinkStatementStub = sandbox.stub(resourceLoader, "refreshFlinkStatement");

  const fakeFlinkStatement = loadFixture(
    "flink-statement-results-processing/fake-flink-statement.json",
  );
  const mockStatement = new FlinkStatement(fakeFlinkStatement);
  mockStatement.metadata = {
    ...mockStatement.metadata,
    created_at: new Date(),
    updated_at: new Date(),
  };

  const notifyUIStub = sandbox.stub();

  const stmtResults = Array.from({ length: 5 }, (_, i) =>
    loadFixture(`flink-statement-results-processing/get-statement-results-${i + 1}.json`),
  );

  // Update the refreshFlinkStatement stub to return the mock statement
  refreshFlinkStatementStub.returns(Promise.resolve(mockStatement));

  let callCount = 0;
  flinkSqlStatementResultsApi.getSqlv1StatementResult.callsFake(() => {
    // Returns 1...stmtResults.length and then returns the last
    // statement result forever.
    const response =
      callCount < stmtResults.length
        ? stmtResults[callCount++]
        : stmtResults[stmtResults.length - 1];
    return Promise.resolve(response);
  });

  const manager = new FlinkStatementResultsManager(
    os,
    mockStatement,
    mockSidecar,
    notifyUIStub,
    DEFAULT_RESULTS_LIMIT,
    0, // Polling interval of 0 for testing
    100, // Refresh interval
    resourceLoader,
  );

  // Wait for results to be processed, it should eventually become 10
  await eventually(() => {
    assert.equal(manager.handleMessage("GetResultsCount", {}).total, 10);

    const results = manager.handleMessage("GetResults", {
      page: 0,
      pageSize: DEFAULT_RESULTS_LIMIT,
    });

    // Verify the results match expected format
    const expectedParsedResults = loadFixture(
      "flink-statement-results-processing/expected-parsed-results.json",
    );
    assert.deepStrictEqual(results, { results: expectedParsedResults });
  }, 10_000);

  return {
    manager,
    statement: mockStatement,
    sidecar: mockSidecar,
    refreshFlinkStatementStub,
    flinkSqlStatementsApi,
    flinkSqlStatementResultsApi,
    notifyUIStub,
    resourceLoader,
    sandbox,
  };
}
