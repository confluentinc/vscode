import * as assert from "assert";
import { ObservableScope } from "inertial";
import { TokenManager } from "../src/authn/oauth2/tokenManager";
import { StatementResultsSqlV1Api, StatementsSqlV1Api } from "../src/clients/flinkSql";
import { DEFAULT_RESULTS_LIMIT } from "../src/flinkSql/flinkStatementResults";
import type {
  FlinkSqlApiProvider,
  MessageType,
} from "../src/flinkSql/flinkStatementResultsManager";
import { FlinkStatementResultsManager } from "../src/flinkSql/flinkStatementResultsManager";
import { CCloudResourceLoader } from "../src/loaders/ccloudResourceLoader";
import type { FlinkStatement } from "../src/models/flinkStatement";
import type { WebviewStorage } from "../src/webview/comms/comms";
import type { ResultsViewerStorageState } from "../src/webview/flink-statement-results";
import { FlinkStatementResultsViewModel } from "../src/webview/flink-statement-results";
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
  flinkApiProvider: FlinkSqlApiProvider;
  statement: FlinkStatement;
  refreshFlinkStatementStub: sinon.SinonStub;
  notifyUIStub: sinon.SinonStub;
  resourceLoader: CCloudResourceLoader;
  sandbox: sinon.SinonSandbox;
  /** Stub for globalThis.fetch, used by the CCloudDataPlaneProxy for results fetching. */
  fetchStub: sinon.SinonStub;
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
  // Create API mocks and provider
  const flinkSqlStatementsApi = sandbox.createStubInstance(StatementsSqlV1Api);
  const flinkSqlStatementResultsApi = sandbox.createStubInstance(StatementResultsSqlV1Api);

  // Create a mock FlinkSqlApiProvider
  const flinkApiProvider: FlinkSqlApiProvider = {
    getFlinkSqlStatementResultsApi: () => flinkSqlStatementResultsApi,
    getFlinkSqlStatementsApi: () => flinkSqlStatementsApi,
  };

  // Create resource loader and statement mocks
  const resourceLoader = CCloudResourceLoader.getInstance();
  const refreshFlinkStatementStub = sandbox.stub(resourceLoader, "refreshFlinkStatement");
  // Stub stopFlinkStatement to delegate to the statements API for testability
  sandbox.stub(resourceLoader, "stopFlinkStatement").callsFake(async () => {
    await flinkSqlStatementsApi.updateSqlv1Statement({} as any);
  });

  const notifyUIStub = sandbox.stub();

  const stmtResults = Array.from({ length: 5 }, (_, i) => {
    const resultsString = loadFixtureFromFile(
      `flink-statement-results-processing/get-statement-results-${i + 1}.json`,
    );
    return JSON.parse(resultsString);
  });

  // Update the refreshFlinkStatement stub to return the mock statement
  refreshFlinkStatementStub.returns(Promise.resolve(statement));

  // Stub TokenManager to return a mock data plane token
  sandbox.stub(TokenManager, "getInstance").returns({
    getDataPlaneToken: sandbox.stub().resolves("test-data-plane-token"),
  } as unknown as TokenManager);

  // Stub globalThis.fetch to return the fixture data when called for statement results
  let fetchCallCount = 0;
  const fetchStub = sandbox
    .stub(globalThis, "fetch")
    .callsFake(async (input: RequestInfo | URL) => {
      const url = input.toString();
      // Check if this is a statement results request
      if (url.includes("/results")) {
        const response =
          fetchCallCount < stmtResults.length
            ? stmtResults[fetchCallCount++]
            : stmtResults[stmtResults.length - 1];
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          headers: new Headers({ "content-type": "application/json" }),
          json: () => Promise.resolve(response),
          text: () => Promise.resolve(JSON.stringify(response)),
        } as Response;
      }
      // For other requests, return an empty response
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "application/json" }),
        json: () => Promise.resolve({}),
        text: () => Promise.resolve("{}"),
      } as Response;
    });

  // Also keep the old API stub for tests that still use it directly
  let legacyCallCount = 0;
  flinkSqlStatementResultsApi.getSqlv1StatementResult.callsFake(() => {
    // Returns 1...stmtResults.length and then returns the last
    // statement result forever.
    const response =
      legacyCallCount < stmtResults.length
        ? stmtResults[legacyCallCount++]
        : stmtResults[stmtResults.length - 1];
    return Promise.resolve(response);
  });

  const os = ObservableScope();

  const manager = new FlinkStatementResultsManager(
    os,
    statement,
    flinkApiProvider,
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
    const expected: string = loadFixtureFromFile(
      "flink-statement-results-processing/expected-parsed-results.json",
    );
    const expectedParsedResults = JSON.parse(expected);
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
      flinkApiProvider,
      refreshFlinkStatementStub,
      flinkSqlStatementsApi,
      flinkSqlStatementResultsApi,
      notifyUIStub,
      resourceLoader,
      sandbox,
      fetchStub,
    },
    vm,
    storage,
  };
}
