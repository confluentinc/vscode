import * as assert from "assert";
import { ObservableScope } from "inertial";
import sinon from "sinon";
import * as messageUtils from "../src/documentProviders/message";
import { eventually } from "../tests/eventually";
import { loadFixture } from "../tests/fixtures/utils";
import { StatementResultsSqlV1Api, StatementsSqlV1Api } from "./clients/flinkSql";
import { FlinkStatementResultsManager } from "./flinkStatementResultsManager";
import { CCloudResourceLoader } from "./loaders/ccloudResourceLoader";
import { FlinkStatement } from "./models/flinkStatement";
import * as sidecar from "./sidecar";
import { DEFAULT_RESULTS_LIMIT } from "./utils/flinkStatementResults";

describe("FlinkStatementResultsManager", () => {
  let sandbox: sinon.SinonSandbox;
  let flinkSqlStatementsApi: sinon.SinonStubbedInstance<StatementsSqlV1Api>;
  let flinkSqlStatementResultsApi: sinon.SinonStubbedInstance<StatementResultsSqlV1Api>;
  let mockSidecar: sinon.SinonStubbedInstance<sidecar.SidecarHandle>;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const schedule_immediately = <T>(cb: () => Promise<T>, _signal?: AbortSignal) => cb();

  let resourceLoader: CCloudResourceLoader;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    // stub the sidecar getFlinkSqlStatementsApi API
    mockSidecar = sandbox.createStubInstance(sidecar.SidecarHandle);
    sandbox.stub(sidecar, "getSidecar").resolves(mockSidecar);

    flinkSqlStatementsApi = sandbox.createStubInstance(StatementsSqlV1Api);
    mockSidecar.getFlinkSqlStatementsApi.returns(flinkSqlStatementsApi);

    flinkSqlStatementResultsApi = sandbox.createStubInstance(StatementResultsSqlV1Api);
    mockSidecar.getFlinkSqlStatementResultsApi.returns(flinkSqlStatementResultsApi);

    resourceLoader = CCloudResourceLoader.getInstance();
  });

  afterEach(() => {
    sandbox.restore();
  });

  const createResultsManagerWithResults = async () => {
    const os = ObservableScope();

    const fakeFlinkStatement = loadFixture(
      "flink-statement-results-processing/fake-flink-statement.json",
    );
    const statementResponses = Array.from({ length: 5 }, (_, i) =>
      loadFixture(`flink-statement-results-processing/get-statement-results-${i + 1}.json`),
    );
    const expectedParsedResults = loadFixture(
      "flink-statement-results-processing/expected-parsed-results.json",
    );

    // Create a proper mock statement with all required fields
    const mockStatement = new FlinkStatement(fakeFlinkStatement);

    mockStatement.metadata = {
      ...mockStatement.metadata,
      created_at: new Date(),
      updated_at: new Date(),
    };

    statementResponses.forEach((response, index) => {
      flinkSqlStatementResultsApi.getSqlv1StatementResult.onCall(index).resolves(response);
    });

    const notifyUIStub = sandbox.stub();

    // Update the refreshFlinkStatement stub to return the mock statement
    sandbox.stub(resourceLoader, "refreshFlinkStatement").returns(Promise.resolve(mockStatement));

    const manager = new FlinkStatementResultsManager(
      os,
      mockStatement,
      mockSidecar,
      schedule_immediately,
      notifyUIStub,
      DEFAULT_RESULTS_LIMIT,
      // Polling interval of 0 for testing
      0,
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
      assert.deepStrictEqual(results, { results: expectedParsedResults });
    }, 10_000);

    return { manager, expectedParsedResults };
  };

  it("should process results from fixtures correctly", async () => {
    const { manager, expectedParsedResults } = await createResultsManagerWithResults();

    // Get all results through message handler
    const results = manager.handleMessage("GetResults", {
      page: 0,
      pageSize: DEFAULT_RESULTS_LIMIT,
    });

    // Verify the results match expected format
    assert.deepStrictEqual(results, { results: expectedParsedResults });
  });

  it("should handle PreviewResult and PreviewAllResults", async () => {
    const { manager, expectedParsedResults } = await createResultsManagerWithResults();

    const showJsonPreviewMock = sandbox.stub(messageUtils, "showJsonPreview").resolves();

    // Simulate double clicking a result row in the UI
    const previewedResult = expectedParsedResults[0];
    let response = manager.handleMessage("PreviewResult", { result: previewedResult });

    sinon.assert.calledOnce(showJsonPreviewMock);
    const [filename, resultArg] = showJsonPreviewMock.firstCall.args;
    assert.ok(filename.startsWith("flink-statement-result-") && filename.endsWith(".json"));
    assert.deepStrictEqual(resultArg, previewedResult);

    // Check the return value
    assert.ok(response.filename.startsWith("flink-statement-result-"));
    assert.ok(response.filename.endsWith(".json"));
    assert.deepStrictEqual(response.result, previewedResult);

    // Now test PreviewAllResults
    response = manager.handleMessage("PreviewAllResults", {});

    // Notice the plural "results"
    assert.ok(response.filename.startsWith("flink-statement-results-"), response.filename);
    assert.ok(response.filename.endsWith(".json"));
    assert.deepStrictEqual(response.result, expectedParsedResults);

    showJsonPreviewMock.restore();
  });

  it("should filter results based on search query", async () => {
    const { manager } = await createResultsManagerWithResults();

    const searchValue = "80.8";

    manager.handleMessage("Search", { search: searchValue });

    const results = await eventually(async () => {
      const { results } = manager.handleMessage("GetResults", {
        page: 0,
        pageSize: DEFAULT_RESULTS_LIMIT,
      });
      assert.equal(results.length, 4);

      return results;
    });

    for (const row of results) {
      const found = Object.values(row).some(
        (value) =>
          value !== null && String(value).toLowerCase().includes(searchValue.toLowerCase()),
      );
      assert.ok(found, `Row does not contain search value: ${JSON.stringify(row)}`);
    }

    const count = manager.handleMessage("GetResultsCount", {});
    assert.strictEqual(count.filter, results.length);

    // Clear search filter
    manager.handleMessage("Search", { search: null });

    const allResults = manager.handleMessage("GetResults", {
      page: 0,
      pageSize: DEFAULT_RESULTS_LIMIT,
    });

    assert.equal(allResults.results.length, 10);

    const totalCount = manager.handleMessage("GetResultsCount", {});
    assert.strictEqual(totalCount.filter, 10);
  });

  it("should filter results based on search query only in visible columns", async () => {
    const { manager } = await createResultsManagerWithResults();

    // Exists in both columns but we should only get results
    // in the visible column `tempf`
    manager.handleMessage("Search", { search: "2" });
    manager.handleMessage("SetVisibleColumns", { visibleColumns: ["tempf"] });

    const hasResults = async (count: number) =>
      await eventually(async () => {
        const { results } = manager.handleMessage("GetResults", {
          page: 0,
          pageSize: DEFAULT_RESULTS_LIMIT,
        });
        assert.equal(results.length, count);
        return results;
      });

    assert.ok(await hasResults(3));

    manager.handleMessage("Search", { search: "2025" });

    assert.ok(await hasResults(0));

    manager.handleMessage("SetVisibleColumns", { visibleColumns: ["when_reported"] });
    assert.ok(await hasResults(10));

    manager.handleMessage("SetVisibleColumns", { visibleColumns: ["when_reported", "tempf"] });
    assert.ok(await hasResults(10));
  });

  it("should filter and then paginate results based on search query", async () => {
    const { manager } = await createResultsManagerWithResults();

    manager.handleMessage("SetVisibleColumns", { visibleColumns: ["tempf"] });

    await eventually(async () => {
      const noFilter: { results: any[] } = manager.handleMessage("GetResults", {
        page: 0,
        pageSize: 5,
      });
      const temperatures = noFilter.results.map((val) => val["tempf"]);

      assert.deepEqual(temperatures, ["80.4", "80.8", "80.8", "80.8", "80.2"]);
    });

    // Apply filter
    manager.handleMessage("Search", { search: "80.8" });

    await eventually(async () => {
      let filtered: { results: any[] } = manager.handleMessage("GetResults", {
        page: 0,
        pageSize: 5,
      });

      // This proves filtering happens before pagination because otherwise
      // we'd have got only three 80.8 values as seen above.
      assert.deepEqual(
        filtered.results.map((val) => val["tempf"]),
        ["80.8", "80.8", "80.8", "80.8"],
      );
    });
  });
});
