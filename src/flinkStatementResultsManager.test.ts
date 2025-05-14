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
import { MessageType, PostFunction } from "./flinkStatementResultsManager";
import { FlinkStatement, Phase } from "./models/flinkStatement";
import { WebviewStorage } from "./webview/comms/comms";
import { createFakeWebviewStorage } from "./webview/comms/fakeStorage";
import {
  FlinkStatementResultsViewModel,
  ResultsViewerStorageState,
} from "./webview/flink-statement-results";

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

    timestamp = os.produce(Date.now(), (ts, _signal) => {
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
      isResultsViewable: ctx.statement.isResultsViewable,
    });
  });

  it("should handle StopStatement message with retries", async () => {
    // Mock the updateSqlv1Statement to fail with 409 twice then succeed
    ctx.flinkSqlStatementsApi.updateSqlv1Statement
      .onFirstCall()
      .rejects(createResponseError(409, "Conflict", "test"));
    ctx.flinkSqlStatementsApi.updateSqlv1Statement
      .onSecondCall()
      .rejects(createResponseError(409, "Conflict", "test"));
    ctx.flinkSqlStatementsApi.updateSqlv1Statement.onThirdCall().resolves();

    await vm.stopStatement();

    await eventually(() => {
      assert.equal(ctx.flinkSqlStatementsApi.updateSqlv1Statement.callCount, 3);
    });
  });

  it("should handle StopStatement message with max retries exceeded", async () => {
    // Mock the updateSqlv1Statement to always fail with 409
    const responseError = createResponseError(409, "Conflict", "test");
    ctx.flinkSqlStatementsApi.updateSqlv1Statement.rejects(responseError);

    // Call stop statement and expect it to throw after max retries
    await vm.stopStatement();
    assert.equal(ctx.flinkSqlStatementsApi.updateSqlv1Statement.callCount, 5);
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
      createResponseError(500, "Server Error", "test"),
    );

    await vm.stopStatement();

    assert.equal(ctx.flinkSqlStatementsApi.updateSqlv1Statement.callCount, 1);
  });

  describe("FlinkStatementResultsViewModel only", () => {
    describe("schema and columns", () => {
      it("should create correct column definitions for table view", () => {
        const columns = vm.columns();
        assert.deepStrictEqual(Object.keys(columns), ["when_reported", "tempf"]);
        assert.strictEqual(columns["when_reported"].title(), "when_reported");
        assert.strictEqual(columns["tempf"].title(), "tempf");
      });

      it("should handle empty schema", () => {
        vm.schema({ columns: [] });
        const columns = vm.columns();
        assert.deepStrictEqual(Object.keys(columns), []);
      });
    });

    describe("pagination", () => {
      it("should calculate correct page buttons", () => {
        // Set up test data
        const buttons = vm.pageButtons();
        assert.deepStrictEqual(buttons, []);

        assert.deepStrictEqual(vm.resultCount(), {
          total: 10,
          filter: 10,
        });
      });

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

    describe("stream state", () => {
      it("should handle stream state changes", () => {
        vm.streamState("running");
        assert.strictEqual(vm.streamState(), "running");

        vm.streamState("completed");
        assert.strictEqual(vm.streamState(), "completed");
      });

      it("should handle stream errors", () => {
        const error = { message: "Test error" };
        vm.streamError(error);
        assert.deepStrictEqual(vm.streamError(), error);
      });
    });

    describe("column resizing", () => {
      it("should initialize column widths with default values", () => {
        const widths = vm.colWidth();
        assert.deepStrictEqual(widths, [8 * 16, 8 * 16]); // 8rem for each column
      });

      it("should generate correct grid template columns", () => {
        vm.colWidth([100, 200]);
        vm.columnVisibilityFlags([true, false]);

        const template = vm.gridTemplateColumns();
        assert.strictEqual(template, "--grid-template-columns: 100px");
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
