import * as assert from "assert";
import { ObservableScope, Scope, Signal } from "inertial";
import sinon from "sinon";
import * as messageUtils from "../src/documentProviders/message";
import {
  FlinkStatementResultsManagerTestContext,
  createTestResultsManagerContext,
} from "../tests/createResultsManager";
import { eventually } from "../tests/eventually";
import { loadFixture } from "../tests/fixtures/utils";
import { createResponseError } from "../tests/unit/testUtils";
import {
  GetSqlv1StatementResult200Response,
  GetSqlv1StatementResult200ResponseApiVersionEnum,
  GetSqlv1StatementResult200ResponseKindEnum,
} from "./clients/flinkSql";
import { MessageType, PostFunction } from "./flinkStatementResultsManager";
import { FlinkStatement, Phase } from "./models/flinkStatement";
import { WebviewStorage } from "./webview/comms/comms";
import {
  FlinkStatementResultsViewModel,
  ResultsViewerStorageState,
} from "./webview/flink-statement-results";

class FakeWebviewStorage<T> implements WebviewStorage<T> {
  private storage: T | undefined;

  get(): T | undefined {
    return this.storage;
  }

  set(state: T): void {
    this.storage = state;
  }
}

function createFakeWebviewStorage<T>(): WebviewStorage<T> {
  return new FakeWebviewStorage<T>();
}

describe("FlinkStatementResultsViewModel and FlinkStatementResultsManager", () => {
  let sandbox: sinon.SinonSandbox;
  let ctx: FlinkStatementResultsManagerTestContext;
  const expectedParsedResults = loadFixture(
    "flink-statement-results-processing/expected-parsed-results.json",
  );
  let os: Scope;
  let storage: WebviewStorage<ResultsViewerStorageState>;
  let post: PostFunction;
  let timestamp: Signal<number>;
  let vm: FlinkStatementResultsViewModel;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    os = ObservableScope();
    ctx = await createTestResultsManagerContext(sandbox, os);

    timestamp = os.produce(Date.now(), (ts) => {
      // Forces a re-render of the view model
      ts(Date.now());
    });
    storage = createFakeWebviewStorage<ResultsViewerStorageState>();

    // Create a post function that directly delegates to the results manager instance
    // and bypasses the webview comms altogether.
    post = (type: MessageType, body: any) => ctx.manager.handleMessage(type, body);

    vm = new FlinkStatementResultsViewModel(os, timestamp, storage, post);
  });

  afterEach(() => {
    sandbox.restore();
    ctx.manager.dispose();
    os.dispose();
  });

  it("should process results from fixtures correctly", async () => {
    // Get all results through message handler
    const results = vm.snapshot();

    // Verify the results match expected format
    assert.deepStrictEqual(results, { results: expectedParsedResults });
  });

  it("should handle PreviewResult and PreviewAllResults", async () => {
    const showJsonPreviewMock = sandbox.stub(messageUtils, "showJsonPreview").resolves();

    // Simulate double clicking a result row in the UI
    const previewedResult = expectedParsedResults[0];
    let response = await vm.previewResult(previewedResult);

    sinon.assert.calledOnce(showJsonPreviewMock);
    const [filename, resultArg] = showJsonPreviewMock.firstCall.args;
    assert.ok(filename.startsWith("flink-statement-result-") && filename.endsWith(".json"));
    assert.deepStrictEqual(resultArg, previewedResult);

    // Check the return value
    assert.ok(response.filename.startsWith("flink-statement-result-"));
    assert.ok(response.filename.endsWith(".json"));
    assert.deepStrictEqual(response.result, previewedResult);

    response = await vm.previewAllResults();

    // Notice the plural "results"
    assert.ok(response.filename.startsWith("flink-statement-results-"), response.filename);
    assert.ok(response.filename.endsWith(".json"));
    assert.deepStrictEqual(response.result, expectedParsedResults);

    showJsonPreviewMock.restore();
  });

  it("should filter results based on search query", async () => {
    const searchValue = "80.8";

    await vm.submitSearch(searchValue);

    await eventually(() => {
      assert.deepEqual(vm.resultCount(), {
        filter: 4,
        total: 10,
      });
    });

    const { results } = vm.snapshot();

    for (const row of results) {
      const found = Object.values(row).some(
        (value) =>
          value !== null && String(value).toLowerCase().includes(searchValue.toLowerCase()),
      );
      assert.ok(found, `Row does not contain search value: ${JSON.stringify(row)}`);
    }

    const count = await vm.resultCount();
    assert.strictEqual(count.filter, results.length);

    // Clear search filter
    await vm.submitSearch("");

    const allResults = await vm.snapshot();

    assert.equal(allResults.results.length, 10);

    const totalCount = await vm.resultCount();
    assert.strictEqual(totalCount.filter, 10);
  });

  it("should filter results based on search query only in visible columns", async () => {
    await eventually(() => assert.deepEqual(vm.visibleColumns(), ["when_reported", "tempf"]));
    // Exists in both columns but we should only get results
    // in the visible column `tempf`
    await vm.submitSearch("2");

    await vm.toggleColumnVisibility(0);
    await eventually(() => assert.deepEqual(vm.visibleColumns(), ["tempf"]));

    const hasResults = async (count: number) =>
      await eventually(() => {
        assert.equal(vm.resultCount().filter, count);
      });

    await hasResults(3);

    await vm.submitSearch("2025");

    await hasResults(0);

    await vm.toggleColumnVisibility(0);
    await vm.toggleColumnVisibility(1);
    await eventually(() => assert.deepEqual(vm.visibleColumns(), ["when_reported"]));

    await hasResults(10);

    vm.toggleColumnVisibility(1);
    await eventually(() => assert.deepEqual(vm.visibleColumns(), ["when_reported", "tempf"]));

    await hasResults(10);
  });

  it("should filter and then paginate results based on search query", async () => {
    await vm.toggleColumnVisibility(0);
    await eventually(() => assert.deepEqual(vm.visibleColumns(), ["tempf"]));

    // Set page size to 5, note that changing this is currently not support via UI
    vm.pageSize(5);

    await eventually(async () => {
      const noFilter = vm.snapshot();
      const temperatures = noFilter.results.map((val) => val["tempf"]);

      assert.deepEqual(temperatures, ["80.4", "80.8", "80.8", "80.8", "80.2"]);
    });

    // Apply filter
    await vm.submitSearch("80.8");

    await eventually(() => {
      let filtered = vm.snapshot();

      // This proves filtering happens before pagination because otherwise
      // we'd have got only three 80.8 values as seen above.
      assert.deepEqual(
        filtered.results.map((val) => val["tempf"]),
        ["80.8", "80.8", "80.8", "80.8"],
      );
    });
  });

  it("should handle GetStatementMeta message", async () => {
    const meta = vm.statementMeta();
    assert.deepStrictEqual(meta, {
      name: ctx.statement.name,
      status: ctx.statement.status?.phase,
      startTime: ctx.statement.metadata?.created_at,
      detail: ctx.statement.status?.detail ?? null,
      failed: ctx.statement.failed,
      stoppable: ctx.statement.stoppable,
      areResultsViewable: ctx.statement.areResultsViewable,
    });
  });

  it("should stop polling when statement is not results viewable", async () => {
    assert.ok(ctx.manager["_pollingInterval"] as NodeJS.Timeout);

    const nonViewableStatement = new FlinkStatement({
      ...ctx.statement,
      status: {
        ...ctx.statement.status,
        phase: Phase.FAILED,
        detail: "Statement failed",
      },
    });
    ctx.refreshFlinkStatementStub.returns(Promise.resolve(nonViewableStatement));

    // Verify polling was stopped
    await eventually(() => {
      assert.equal(ctx.manager["_pollingInterval"], undefined);
    });
  });

  it("should handle non-409 errors in StopStatement immediately", async () => {
    ctx.flinkSqlStatementsApi.updateSqlv1Statement.rejects(
      createResponseError(500, "Server Error", "{}"),
    );

    await vm.stopStatement();

    assert.equal(ctx.flinkSqlStatementsApi.updateSqlv1Statement.callCount, 1);
  });

  describe("with fetchResults not running in a setInterval", () => {
    let clock: sinon.SinonFakeTimers;

    beforeEach(() => {
      clearInterval(ctx.manager["_pollingInterval"]);
      ctx.manager["_pollingInterval"] = undefined;
      ctx.flinkSqlStatementResultsApi.getSqlv1StatementResult.resetHistory();

      // TODO: Eventually, the idea would be to move this fake timer up to
      //       the top-level describe's beforeEach.
      //       See https://github.com/confluentinc/vscode/issues/1807
      clock = sinon.useFakeTimers({ shouldClearNativeTimers: true });
    });

    afterEach(() => {
      clock.restore();
    });

    it("should handle StopStatement message with retries", async () => {
      // Mock the updateSqlv1Statement to fail with 409 twice then succeed
      ctx.flinkSqlStatementsApi.updateSqlv1Statement
        .onFirstCall()
        .rejects(createResponseError(409, "Conflict", "{}"));
      ctx.flinkSqlStatementsApi.updateSqlv1Statement
        .onSecondCall()
        .rejects(createResponseError(409, "Conflict", "{}"));
      ctx.flinkSqlStatementsApi.updateSqlv1Statement.onThirdCall().resolves();

      const stopPromise = vm.stopStatement();

      await clock.tickAsync(3000);

      await stopPromise;

      assert.equal(ctx.flinkSqlStatementsApi.updateSqlv1Statement.callCount, 3);
    });

    it("should handle StopStatement message with max retries exceeded", async () => {
      // Mock the updateSqlv1Statement to always fail with 409
      const responseError = createResponseError(409, "Conflict", "{}");
      ctx.flinkSqlStatementsApi.updateSqlv1Statement.rejects(responseError);

      // Call stop statement and expect it to throw after max retries
      const stopPromise = vm.stopStatement();

      await clock.tickAsync(61 * 500);

      await stopPromise;
      assert.equal(ctx.flinkSqlStatementsApi.updateSqlv1Statement.callCount, 60);
    });

    it("should abort in-flight get results when stopping statement", async () => {
      // Create a promise that we can reject manually to simulate the aborted request
      let rejectRequest: (reason: Error) => void;
      const requestPromise = new Promise<GetSqlv1StatementResult200Response>((_resolve, reject) => {
        rejectRequest = reject;
      });

      // Start a get results request that will be in flight
      ctx.flinkSqlStatementResultsApi.getSqlv1StatementResult.returns(requestPromise);

      // Start the get results request
      const fetchPromise = ctx.manager.fetchResults();

      // Wait for the request to actually start
      await eventually(() => {
        assert.ok(ctx.flinkSqlStatementResultsApi.getSqlv1StatementResult.calledOnce);
      });

      // While that's in flight, start stopping the statement
      const stopPromise = vm.stopStatement();

      // Verify the abort controller was triggered
      assert.ok(ctx.manager["_getResultsAbortController"].signal.aborted);

      // Verify the in-flight request was aborted
      const callArgs = ctx.flinkSqlStatementResultsApi.getSqlv1StatementResult.firstCall.args[1];
      assert.ok(
        callArgs &&
          typeof callArgs === "object" &&
          "signal" in callArgs &&
          callArgs.signal?.aborted,
      );

      // Now reject the request
      const abortError = new Error("Aborted") as Error & { cause?: { name: string } };
      abortError.cause = { name: "AbortError" };
      rejectRequest!(abortError);

      // Complete both operations
      await Promise.all([fetchPromise, stopPromise]);

      // Try another fetch - should not make a new request
      await ctx.manager["fetchResults"]();
      assert.equal(ctx.flinkSqlStatementResultsApi.getSqlv1StatementResult.callCount, 1);
    });

    it("should retry get statement results when 409", async () => {
      // Mock the getSqlv1StatementResult to fail with 409 twice then succeed
      // This happens if the statement results are not ready yet
      ctx.flinkSqlStatementResultsApi.getSqlv1StatementResult
        .onFirstCall()
        .rejects(createResponseError(409, "Conflict", "{}"));
      ctx.flinkSqlStatementResultsApi.getSqlv1StatementResult
        .onSecondCall()
        .rejects(createResponseError(409, "Conflict", "{}"));
      ctx.flinkSqlStatementResultsApi.getSqlv1StatementResult.onThirdCall().resolves({
        api_version: GetSqlv1StatementResult200ResponseApiVersionEnum.SqlV1,
        kind: GetSqlv1StatementResult200ResponseKindEnum.StatementResult,
        metadata: {},
        results: {
          data: [],
        },
      });

      // Trigger a fetch
      const fetchPromise = ctx.manager.fetchResults();

      // Advance time to trigger retries
      await clock.tickAsync(500);
      await clock.tickAsync(500);
      await clock.tickAsync(500);

      await fetchPromise;

      // Verify the request was made 3 times
      assert.equal(ctx.flinkSqlStatementResultsApi.getSqlv1StatementResult.callCount, 3);
    });

    it("should handle fetch results with max retries exceeded", async () => {
      // Mock the getSqlv1StatementResult to always fail with 409
      const responseError = createResponseError(409, "Conflict", "{}");
      ctx.flinkSqlStatementResultsApi.getSqlv1StatementResult.rejects(responseError);

      // Trigger a fetch
      const fetchPromise = ctx.manager.fetchResults();

      // Advance time to trigger all retries
      await clock.tickAsync(61 * 500);

      await fetchPromise;

      assert.equal(ctx.flinkSqlStatementResultsApi.getSqlv1StatementResult.callCount, 60);
      // Verify error state is set
      assert.ok(ctx.manager["_latestError"]());
    });

    it("should not retry on non-409 errors during fetch", async () => {
      // Mock the getSqlv1StatementResult to fail with 500
      const responseError = createResponseError(500, "Internal Server Error", "{}");
      ctx.flinkSqlStatementResultsApi.getSqlv1StatementResult.rejects(responseError);

      // Trigger a fetch
      const fetchPromise = ctx.manager.fetchResults();

      // Advance time to ensure no retries happen
      await clock.tickAsync(1000);

      await fetchPromise;

      assert.equal(ctx.flinkSqlStatementResultsApi.getSqlv1StatementResult.callCount, 1);
      // Verify error state is set
      assert.ok(ctx.manager["_latestError"]());
    });

    it("should only allow one instance of fetchResults to run at a time", async () => {
      // Create a promise that we can resolve manually to simulate a slow API call
      let resolveRequest: (value: GetSqlv1StatementResult200Response) => void;
      const requestPromise = new Promise<GetSqlv1StatementResult200Response>((resolve) => {
        resolveRequest = resolve;
      });

      // Mock the API call to use our controllable promise
      ctx.flinkSqlStatementResultsApi.getSqlv1StatementResult.returns(requestPromise);

      // Start multiple concurrent fetchResults calls
      const fetchPromises = [
        ctx.manager.fetchResults(),
        ctx.manager.fetchResults(),
        ctx.manager.fetchResults(),
        ctx.manager.fetchResults(),
        ctx.manager.fetchResults(),
      ];

      // Advance time to ensure all calls have started
      await clock.tickAsync(50);

      // Verify only one API call was made
      assert.equal(ctx.flinkSqlStatementResultsApi.getSqlv1StatementResult.callCount, 1);

      // Resolve the API call
      resolveRequest!({
        api_version: GetSqlv1StatementResult200ResponseApiVersionEnum.SqlV1,
        kind: GetSqlv1StatementResult200ResponseKindEnum.StatementResult,
        metadata: {},
        results: { data: [] },
      });

      // Wait for all calls to complete
      await Promise.all(fetchPromises);

      // Verify still only one API call was made
      assert.equal(ctx.flinkSqlStatementResultsApi.getSqlv1StatementResult.callCount, 1);
    });
  });

  describe("FlinkStatementResultsViewModel only", () => {
    describe("schema and columns", () => {
      it("should create correct column definitions for table view", () => {
        const columns = vm.columns();
        assert.deepStrictEqual(Object.keys(columns), ["when_reported", "tempf"]);
        assert.strictEqual(columns["when_reported"].title(), "when_reported");
        assert.strictEqual(columns["tempf"].title(), "tempf");
      });

      it("should get schema correctly", () => {
        const schema = vm.schema();

        assert.deepStrictEqual(schema, {
          columns: [
            {
              name: "when_reported",
              type: {
                nullable: false,
                precision: 6,
                type: "TIMESTAMP_WITH_LOCAL_TIME_ZONE",
              },
            },
            {
              name: "tempf",
              type: {
                nullable: false,
                type: "DOUBLE",
              },
            },
          ],
        });
      });

      it("should handle empty schema", () => {
        vm.schema({ columns: [] });
        const columns = vm.columns();
        assert.deepStrictEqual(Object.keys(columns), []);
      });
    });

    describe("pagination", () => {
      it("should handle empty results", () => {
        vm.pageSize(10);
        vm.resultCount({ total: 0, filter: null });

        const buttons = vm.pageButtons();
        assert.deepStrictEqual(buttons, []);
      });

      it("should generate correct page stat label", async () => {
        vm.pageSize(10);
        vm.page(1);
        vm.resultCount({ total: 25, filter: null });

        const label = vm.pageStatLabel();
        await eventually(() => assert.strictEqual(label, "Showing 11..20 of 25 results."));
      });

      it("should handle filtered results in page stat label", async () => {
        vm.pageSize(10);
        vm.page(0);
        vm.resultCount({ total: 25, filter: 15 });

        const label = vm.pageStatLabel();
        await eventually(() =>
          assert.strictEqual(label, "Showing 1..10 of 15 results (total: 25)."),
        );
      });

      it("should generate correct page buttons for large result sets", () => {
        vm.resultCount({ total: 1000, filter: null });
        vm.pageSize(10);
        vm.page(5);

        const buttons = vm.pageButtons();
        assert.deepStrictEqual(buttons, [0, "ldot", 3, 4, 5, 6, 7, "rdot", 99]);
      });

      it("should persist page state in storage", () => {
        vm.page(2);
        const stored = storage.get()?.page;
        assert.strictEqual(stored, 2);
      });

      it("should handle page size changes", async () => {
        vm.pageSize(1);

        const buttons = vm.pageButtons();
        // Since there are 10 results, page buttons should be: 1, 2, 3...10
        await eventually(() => assert.deepStrictEqual(buttons, [0, 1, 2, "rdot", 9]));
      });
    });

    describe("column visibility", () => {
      it("should initialize with all columns visible", () => {
        const visibleColumns = vm.visibleColumns();
        assert.deepStrictEqual(visibleColumns, ["when_reported", "tempf"]);
      });

      it("should check column visibility correctly", () => {
        assert.strictEqual(vm.isColumnVisible(0), true);
        assert.strictEqual(vm.isColumnVisible(1), true);
      });

      it("should prevent hiding the last visible column", async () => {
        await vm.toggleColumnVisibility(0);
        await vm.toggleColumnVisibility(1);

        // Try to hide the last column
        await vm.toggleColumnVisibility(0);
        assert.strictEqual(vm.isColumnVisible(0), true);
      });

      it("should persist column visibility state", async () => {
        await vm.toggleColumnVisibility(0);
        const stored = storage.get()?.columnVisibilityFlags;
        assert.deepStrictEqual(stored, [false, true]);
      });
    });

    describe("search and input handling", () => {
      it("should handle Enter key for immediate search", async () => {
        const event = {
          key: "Enter",
          target: { value: "test" },
          preventDefault: () => {},
        } as unknown as KeyboardEvent;
        await vm.handleKeydown(event);

        // Verify search was submitted immediately
        assert.strictEqual(vm.searchTimer, null);
      });

      it("should debounce search input", async () => {
        const event = {
          target: { value: "test" },
          preventDefault: () => {},
        } as unknown as KeyboardEvent;
        await vm.handleKeydown(event);

        assert.ok(vm.searchTimer);
        // Wait for debounce
        await new Promise((resolve) => setTimeout(resolve, vm.searchDebounceTime));
        assert.strictEqual(vm.searchTimer, null);
      });
    });
  });
});
