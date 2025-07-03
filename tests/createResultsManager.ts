import * as assert from "assert";
import { ObservableScope } from "inertial";
import { StatementResultsSqlV1Api, StatementsSqlV1Api } from "../src/clients/flinkSql";
import { FlinkStatementResultsManager, MessageType } from "../src/flinkStatementResultsManager";
import { CCloudResourceLoader } from "../src/loaders/ccloudResourceLoader";
import { FlinkStatement } from "../src/models/flinkStatement";
import * as sidecar from "../src/sidecar";
import { DEFAULT_RESULTS_LIMIT } from "../src/utils/flinkStatementResults";
import { WebviewStorage } from "../src/webview/comms/comms";
import {
  FlinkStatementResultsViewModel,
  ResultsViewerStorageState,
} from "../src/webview/flink-statement-results";
import { eventually } from "./eventually";
import { loadFixtureFromFile } from "./fixtures/utils";

class FakeWebviewStorage<T> implements WebviewStorage<T> {
  private storage: T | undefined;

  get(): T | undefined {
    return this.storage;
  }

  set(state: T): void {
    this.storage = state;
  }
}

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
 * Creates a FlinkStatementResultsViewModel and FlinkStatementResultsManager instance pre-loaded with WeatherData fixture results for testing.
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
 * @returns Initialized FlinkStatementResultsViewModel and FlinkStatementResultsManager with processed results
 */

export async function createTestResultsManagerContext(
  sandbox: sinon.SinonSandbox,
  statement: FlinkStatement,
): Promise<{
  ctx: FlinkStatementResultsManagerTestContext;
  storage: WebviewStorage<ResultsViewerStorageState>;
  vm: FlinkStatementResultsViewModel;
}> {
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

  const notifyUIStub = sandbox.stub();

  const stmtResults = Array.from({ length: 5 }, (_, i) => {
    const resultsString = loadFixtureFromFile(
      `flink-statement-results-processing/get-statement-results-${i + 1}.json`,
    );
    return JSON.parse(resultsString);
  });

  // Update the refreshFlinkStatement stub to return the mock statement
  refreshFlinkStatementStub.returns(Promise.resolve(statement));

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

  const os = ObservableScope();

  const manager = new FlinkStatementResultsManager(
    os,
    statement,
    mockSidecar,
    notifyUIStub,
    DEFAULT_RESULTS_LIMIT,
    // Polling interval of 1ms
    1,
    // Refresh interval
    100,
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
    const expectedParsedResults = loadFixtureFromFile(
      "flink-statement-results-processing/expected-parsed-results.json",
    );
    assert.deepStrictEqual(results, { results: expectedParsedResults });
  }, 10_000);

  const storage = new FakeWebviewStorage<ResultsViewerStorageState>();
  const timestamp = os.produce(Date.now(), (ts) => {
    // Forces a re-render of the view model
    ts(Date.now());
  });

  // Create a post function that directly delegates to the results manager instance
  // and bypasses the webview comms altogether.
  const post = (type: MessageType, body: any) => manager.handleMessage(type, body);

  const vm = new FlinkStatementResultsViewModel(os, timestamp, storage, post);

  return {
    ctx: {
      manager,
      statement,
      sidecar: mockSidecar,
      refreshFlinkStatementStub,
      flinkSqlStatementsApi,
      flinkSqlStatementResultsApi,
      notifyUIStub,
      resourceLoader,
      sandbox,
    },
    vm,
    storage,
  };
}
