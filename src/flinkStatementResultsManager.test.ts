import * as assert from "assert";
import { ObservableScope } from "inertial";
import sinon from "sinon";
import * as messageUtils from "../src/documentProviders/message";
import { eventually } from "../tests/eventually";
import { loadFixture } from "../tests/fixtures/utils";
import { createResponseError } from "../tests/unit/testUtils";
import { StatementResultsSqlV1Api, StatementsSqlV1Api } from "./clients/flinkSql";
import { FlinkStatementResultsManager } from "./flinkStatementResultsManager";
import { CCloudResourceLoader } from "./loaders/ccloudResourceLoader";
import { FlinkStatement, Phase } from "./models/flinkStatement";
import * as sidecar from "./sidecar";
import { DEFAULT_RESULTS_LIMIT } from "./utils/flinkStatementResults";

describe("FlinkStatementResultsManager", () => {
  let sandbox: sinon.SinonSandbox;
  let manager: FlinkStatementResultsManager;
  let flinkSqlStatementsApi: sinon.SinonStubbedInstance<StatementsSqlV1Api>;
  let flinkSqlStatementResultsApi: sinon.SinonStubbedInstance<StatementResultsSqlV1Api>;
  let mockSidecar: sinon.SinonStubbedInstance<sidecar.SidecarHandle>;
  let mockStatement: FlinkStatement;
  let refreshFlinkStatementStub: sinon.SinonStub;
  let resourceLoader: CCloudResourceLoader;
  const expectedParsedResults = loadFixture(
    "flink-statement-results-processing/expected-parsed-results.json",
  );

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
    refreshFlinkStatementStub = sandbox.stub(resourceLoader, "refreshFlinkStatement");
  });

  afterEach(() => {
    sandbox.restore();

    if (manager) {
      manager.dispose();
    }
  });

  const createResultsManagerWithResults = async () => {
    const os = ObservableScope();

    const fakeFlinkStatement = loadFixture(
      "flink-statement-results-processing/fake-flink-statement.json",
    );
    const stmtResults = Array.from({ length: 5 }, (_, i) =>
      loadFixture(`flink-statement-results-processing/get-statement-results-${i + 1}.json`),
    );

    // Create a proper mock statement with all required fields
    mockStatement = new FlinkStatement(fakeFlinkStatement);

    mockStatement.metadata = {
      ...mockStatement.metadata,
      created_at: new Date(),
      updated_at: new Date(),
    };

    const notifyUIStub = sandbox.stub();

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

    manager = new FlinkStatementResultsManager(
      os,
      mockStatement,
      mockSidecar,
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
  };

  it("should process results from fixtures correctly", async () => {
    await createResultsManagerWithResults();

    // Get all results through message handler
    const results = manager.handleMessage("GetResults", {
      page: 0,
      pageSize: DEFAULT_RESULTS_LIMIT,
    });

    // Verify the results match expected format
    assert.deepStrictEqual(results, { results: expectedParsedResults });
  });

  it("should handle PreviewResult and PreviewAllResults", async () => {
    await createResultsManagerWithResults();

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
    await createResultsManagerWithResults();

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
    await createResultsManagerWithResults();

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
    await createResultsManagerWithResults();

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

  it("should handle GetStatementMeta message", async () => {
    await createResultsManagerWithResults();

    const meta = manager.handleMessage("GetStatementMeta", {});
    assert.deepStrictEqual(meta, {
      name: mockStatement.name,
      status: mockStatement.status?.phase,
      startTime: mockStatement.metadata?.created_at,
      detail: mockStatement.status?.detail ?? null,
      failed: mockStatement.failed,
      stoppable: mockStatement.stoppable,
      isResultsViewable: mockStatement.isResultsViewable,
    });
  });

  it("should handle StopStatement message with retries", async () => {
    await createResultsManagerWithResults();

    // Mock the updateSqlv1Statement to fail with 409 twice then succeed
    flinkSqlStatementsApi.updateSqlv1Statement
      .onFirstCall()
      .rejects(createResponseError(409, "Conflict", "test"));
    flinkSqlStatementsApi.updateSqlv1Statement
      .onSecondCall()
      .rejects(createResponseError(409, "Conflict", "test"));
    flinkSqlStatementsApi.updateSqlv1Statement.onThirdCall().resolves();

    await manager.handleMessage("StopStatement", {});

    await eventually(() => {
      assert.equal(flinkSqlStatementsApi.updateSqlv1Statement.callCount, 3);
    });
  });

  it("should handle StopStatement message with max retries exceeded", async () => {
    await createResultsManagerWithResults();

    // Mock the updateSqlv1Statement to always fail with 409
    const responseError = createResponseError(409, "Conflict", "test");
    flinkSqlStatementsApi.updateSqlv1Statement.rejects(responseError);

    // Call stop statement and expect it to throw after max retries
    await manager.handleMessage("StopStatement", {});
    assert.equal(flinkSqlStatementsApi.updateSqlv1Statement.callCount, 5);
  });

  it("should stop polling when statement is not results viewable", async () => {
    await createResultsManagerWithResults();

    assert.ok(manager["_pollingInterval"] as NodeJS.Timeout);

    const nonViewableStatement = new FlinkStatement({
      ...mockStatement,
      status: {
        ...mockStatement.status,
        phase: Phase.FAILED,
        detail: "Statement failed",
      },
    });
    refreshFlinkStatementStub.returns(Promise.resolve(nonViewableStatement));

    // Verify polling was stopped
    await eventually(() => {
      assert.equal(manager["_pollingInterval"], undefined);
    });
  });

  it("should handle non-409 errors in StopStatement immediately", async () => {
    await createResultsManagerWithResults();

    flinkSqlStatementsApi.updateSqlv1Statement.rejects(
      createResponseError(500, "Server Error", "test"),
    );

    await manager.handleMessage("StopStatement", {});

    assert.equal(flinkSqlStatementsApi.updateSqlv1Statement.callCount, 1);
  });
});
