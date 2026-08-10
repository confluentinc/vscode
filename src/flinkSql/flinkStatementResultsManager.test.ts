import * as assert from "assert";
import sinon from "sinon";
import * as vscode from "vscode";
import type { FlinkStatementResultsManagerTestContext } from "../../tests/createResultsManager";
import { createTestResultsManagerContext } from "../../tests/createResultsManager";
import { eventually } from "../../tests/eventually";
import { loadFixtureFromFile } from "../../tests/fixtures/utils";
import {
  createResponseError,
  createSingleUseResponseError,
  ResponseErrorSource,
} from "../../tests/unit/testUtils";
import type { GetSqlv1StatementResult200Response } from "../clients/flinkSql";
import {
  GetSqlv1StatementResult200ResponseApiVersionEnum,
  GetSqlv1StatementResult200ResponseKindEnum,
} from "../clients/flinkSql";
import * as messageUtils from "../documentProviders/message";
import { FlinkStatement, Phase } from "../models/flinkStatement";
import type { WebviewStorage } from "../webview/comms/comms";
import type {
  FlinkStatementResultsViewModel,
  ResultsViewerStorageState,
} from "../webview/flink-statement-results";
import { transientBackoffWindow } from "./flinkStatementResultsManager";

/** A successful results response carrying no rows. */
const EMPTY_RESULTS_RESPONSE: GetSqlv1StatementResult200Response = {
  api_version: GetSqlv1StatementResult200ResponseApiVersionEnum.SqlV1,
  kind: GetSqlv1StatementResult200ResponseKindEnum.StatementResult,
  metadata: {},
  results: { data: [] },
};

function createMockStatement(): FlinkStatement {
  const fakeFlinkStatement = loadFixtureFromFile(
    "flink-statement-results-processing/fake-flink-statement.json",
  );
  const mockStatement = new FlinkStatement(JSON.parse(fakeFlinkStatement));
  mockStatement.metadata = {
    ...mockStatement.metadata,
    created_at: new Date(),
    updated_at: new Date(),
  };
  return mockStatement;
}

describe("FlinkStatementResultsViewModel and FlinkStatementResultsManager", () => {
  let sandbox: sinon.SinonSandbox;
  let ctx: FlinkStatementResultsManagerTestContext;
  const resultsString = loadFixtureFromFile(
    "flink-statement-results-processing/expected-parsed-results.json",
  );
  const expectedParsedResults = JSON.parse(resultsString);
  let vm: FlinkStatementResultsViewModel;
  const statement: FlinkStatement = createMockStatement();

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    ({ ctx, vm } = await createTestResultsManagerContext(sandbox, statement));
  });

  afterEach(() => {
    sandbox.restore();
    ctx.manager.dispose();
    vm.dispose();
  });

  it("should process results from fixtures correctly", async () => {
    // Get all results through message handler
    const results = vm.snapshot();

    // Verify the results match expected format
    assert.deepStrictEqual(results, { results: expectedParsedResults });
  });

  it("should handle viewing the statement source", async () => {
    const executeCommandStub = sandbox.stub(vscode.commands, "executeCommand");

    // Simulate hitting the button to view the statement source
    await vm.viewStatementSource();
    sinon.assert.calledOnce(executeCommandStub);
    sinon.assert.calledWith(
      executeCommandStub,
      "confluent.statements.viewstatementsql",
      ctx.statement,
    );
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

  it("should filter results based on search query across table and changelog mode", async () => {
    const searchValue = "80.8";
    await vm.submitSearch(searchValue);

    await eventually(() => {
      assert.deepEqual(vm.resultCount(), {
        filter: 4,
        total: 10,
      });
    });

    await vm.setViewMode("changelog");

    await eventually(() => {
      assert.deepEqual(vm.resultCount(), {
        filter: 4,
        total: 468,
      });
    });

    // Clear the search
    await vm.submitSearch("");

    // We should see all of the changelog results
    await eventually(() => {
      assert.deepEqual(vm.resultCount(), {
        filter: 468,
        total: 468,
      });
    });

    // Now search for a value that's only present in the changelog view
    await vm.submitSearch("63.5");

    await eventually(() => {
      assert.deepEqual(vm.resultCount(), {
        filter: 12,
        total: 468,
      });
    });

    // Switch to table view
    await vm.setViewMode("table");

    // We should see no results
    await eventually(() => {
      assert.deepEqual(vm.resultCount(), {
        filter: 0,
        total: 10,
      });
    });
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

    await vm.toggleColumnVisibility(1);
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
      areResultsViewable: ctx.statement.canRequestResults,
      possiblyViewable: ctx.statement.possiblyViewable,
      isForeground: ctx.statement.isForeground,
      warnings: ctx.statement.warnings,
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

      // Eventually, the idea would be to move this fake timer up to
      // the top-level describe's beforeEach.
      // See https://github.com/confluentinc/vscode/issues/1807
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
        sinon.assert.calledOnce(ctx.flinkSqlStatementResultsApi.getSqlv1StatementResult);
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
      ctx.flinkSqlStatementResultsApi.getSqlv1StatementResult
        .onThirdCall()
        .resolves(EMPTY_RESULTS_RESPONSE);

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

    it("should not retry on errors that are neither 409 nor transient during fetch", async () => {
      const responseError = createResponseError(403, "Forbidden", "{}");
      ctx.flinkSqlStatementResultsApi.getSqlv1StatementResult.rejects(responseError);

      // Trigger a fetch
      const fetchPromise = ctx.manager.fetchResults();

      // Advance time to ensure no retries happen
      await clock.tickAsync(1000);

      await fetchPromise;

      sinon.assert.calledOnce(ctx.flinkSqlStatementResultsApi.getSqlv1StatementResult);
      // Verify error state is set
      assert.ok(ctx.manager["_latestError"]());
    });

    it("should retry get statement results on transient errors", async () => {
      // CCloud briefly can't resolve a just-created statement, answering 429 or 5xx before the
      // results endpoint starts working
      ctx.flinkSqlStatementResultsApi.getSqlv1StatementResult
        .onFirstCall()
        .rejects(createResponseError(429, "Too Many Requests", "{}"));
      ctx.flinkSqlStatementResultsApi.getSqlv1StatementResult
        .onSecondCall()
        .rejects(createResponseError(500, "Internal Server Error", "{}"));
      ctx.flinkSqlStatementResultsApi.getSqlv1StatementResult
        .onThirdCall()
        .resolves(EMPTY_RESULTS_RESPONSE);

      const fetchPromise = ctx.manager.fetchResults();

      // backoff doubles from 500ms and is jittered, so tick past the two maximums
      await clock.tickAsync(500 + 1000);

      await fetchPromise;

      sinon.assert.calledThrice(ctx.flinkSqlStatementResultsApi.getSqlv1StatementResult);
      assert.equal(ctx.manager["_latestError"](), null);
    });

    it("should wait for the server's Retry-After rather than the exponential curve", async () => {
      ctx.flinkSqlStatementResultsApi.getSqlv1StatementResult.onFirstCall().rejects(
        createResponseError(429, "Too Many Requests", "{}", ResponseErrorSource.Sidecar, {
          "retry-after": "2",
        }),
      );
      ctx.flinkSqlStatementResultsApi.getSqlv1StatementResult
        .onSecondCall()
        .resolves(EMPTY_RESULTS_RESPONSE);

      const fetchPromise = ctx.manager.fetchResults();

      // the exponential curve would have retried by now, but the server asked for 2s
      await clock.tickAsync(1000);
      sinon.assert.calledOnce(ctx.flinkSqlStatementResultsApi.getSqlv1StatementResult);

      // 2s as requested, plus up to one base delay of jitter on top
      await clock.tickAsync(1500);
      await fetchPromise;

      sinon.assert.calledTwice(ctx.flinkSqlStatementResultsApi.getSqlv1StatementResult);
      assert.equal(ctx.manager["_latestError"](), null);
    });

    it("should complete the stream after exhausting transient retries", async () => {
      ctx.flinkSqlStatementResultsApi.getSqlv1StatementResult.rejects(
        createResponseError(500, "Internal Server Error", "{}"),
      );

      const fetchPromise = ctx.manager.fetchResults();

      // 4 transient retries at up to 500/1000/2000/4000ms
      await clock.tickAsync(7500);

      await fetchPromise;

      // 1 initial attempt + MAX_TRANSIENT_RETRIES
      sinon.assert.callCount(ctx.flinkSqlStatementResultsApi.getSqlv1StatementResult, 5);
      assert.ok(ctx.manager["_latestError"]());
      assert.equal(ctx.manager["_state"](), "completed");
    });

    it("should stop waiting out a transient backoff when the manager is disposed", async () => {
      const stub = ctx.flinkSqlStatementResultsApi.getSqlv1StatementResult;
      stub.rejects(createResponseError(500, "Internal Server Error", "{}"));

      const fetchPromise = ctx.manager.fetchResults();
      // let the first attempt fail and settle into its backoff
      await clock.tickAsync(1);
      sinon.assert.calledOnce(stub);

      ctx.manager.dispose();

      // settles without the clock ever reaching the end of that backoff, which is the point: a real
      // aborted signal would also end the loop, but only after the full wait
      await fetchPromise;
    });

    it("should not report a disposal-interrupted fetch as an error", async () => {
      const stub = ctx.flinkSqlStatementResultsApi.getSqlv1StatementResult;
      stub.rejects(createResponseError(500, "Internal Server Error", "{}"));

      const fetchPromise = ctx.manager.fetchResults();
      await clock.tickAsync(1);
      ctx.manager.dispose();
      await fetchPromise;

      // aborting rethrows the 500 that started the retry; surfacing it would toast the user for
      // closing the results pane
      assert.equal(ctx.manager["_latestError"](), null);
    });

    it("should not let transient retries eat into the 409 budget", async () => {
      // 4 transient retries first, exhausting that budget, then nothing but 409s
      const stub = ctx.flinkSqlStatementResultsApi.getSqlv1StatementResult;
      for (let i = 0; i < 4; i++) {
        stub.onCall(i).rejects(createResponseError(500, "Internal Server Error", "{}"));
      }
      stub.rejects(createResponseError(409, "Conflict", "{}"));

      const fetchPromise = ctx.manager.fetchResults();

      // 7500ms covers the transient backoffs, then the 409 waits with a little margin
      await clock.tickAsync(7500 + 61 * 500);

      await fetchPromise;

      // 4 transient calls + the 409s' full 60-attempt budget, untouched by them
      sinon.assert.callCount(stub, 64);
    });

    it("should leave the error response body readable for logging", async () => {
      // a real single-use Response, so reading the body without cloning would be observable
      const responseError = createSingleUseResponseError(
        400,
        "Bad Request",
        '{"errors":[{"code":"cr_failed_get_stmt_name"}]}',
      );
      ctx.flinkSqlStatementResultsApi.getSqlv1StatementResult.rejects(responseError);

      await ctx.manager.fetchResults();

      assert.strictEqual(responseError.response.bodyUsed, false);
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
      resolveRequest!(EMPTY_RESULTS_RESPONSE);

      // Wait for all calls to complete
      await Promise.all(fetchPromises);

      // Verify still only one API call was made
      assert.equal(ctx.flinkSqlStatementResultsApi.getSqlv1StatementResult.callCount, 1);
    });
  });
});

describe("FlinkStatementResultsViewModel only", () => {
  let sandbox: sinon.SinonSandbox;
  const statement = createMockStatement();

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("with default statement", () => {
    let vm: FlinkStatementResultsViewModel;
    let storage: WebviewStorage<ResultsViewerStorageState>;
    let ctx: FlinkStatementResultsManagerTestContext;

    beforeEach(async () => {
      ({ storage, vm, ctx } = await createTestResultsManagerContext(sandbox, statement));
    });

    afterEach(() => {
      ctx.manager.dispose();
      vm.dispose();
    });

    describe("viewMode", () => {
      it("should initialize with table view mode", () => {
        assert.strictEqual(vm.viewMode(), "table");
      });

      it("should toggle between table and changelog view modes", async () => {
        // Initial state
        assert.strictEqual(vm.viewMode(), "table");
        assert.strictEqual(vm.page(), 0);
        assert.strictEqual(vm.tablePage(), 0);
        assert.strictEqual(vm.changelogPage(), 0);

        // Toggle to changelog
        await vm.setViewMode("changelog");
        await eventually(() => assert.strictEqual(vm.viewMode(), "changelog"));
        assert.strictEqual(vm.page(), 0);
        assert.strictEqual(vm.tablePage(), 0);
        assert.strictEqual(vm.changelogPage(), 0);

        // Change page in changelog mode
        vm.page(2);
        await eventually(() => assert.strictEqual(vm.page(), 2));

        assert.strictEqual(vm.tablePage(), 0);
        // We don't eagerly update the changelogPage..
        assert.strictEqual(vm.changelogPage(), 0);

        // Toggle back to table
        await vm.setViewMode("table");

        await eventually(() => {
          assert.strictEqual(vm.viewMode(), "table");
          assert.strictEqual(vm.page(), 0);
          assert.strictEqual(vm.tablePage(), 0);
          assert.strictEqual(vm.changelogPage(), 2);
        });
      });
    });

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

    it("should handle column widths correctly when toggling between changelog and table mode", async () => {
      // Test default column widths
      assert.deepStrictEqual(vm.colWidth(), [128, 128]); // 8rem * 16px = 128px for each column

      const setWidths = (widths: number[]) => {
        vm.colWidth(widths);
        storage.set({ ...storage.get()!, colWidths: vm.colWidth() });
      };

      setWidths([150, 200]);

      // Test switching to changelog view mode
      await vm.setViewMode("changelog");
      assert.deepStrictEqual(vm.colWidth(), [128, 150, 200]); // Default width for Operation column + stored widths

      // Change width of Operation column
      setWidths([64, 150, 200]);

      // Test switching back to table view mode
      await vm.setViewMode("table");
      assert.deepStrictEqual(vm.colWidth(), [150, 200]); // Should remove Operation column width

      await vm.setViewMode("changelog");
      // Assert that changes to Operation column's width are persisted
      // across view mode toggles.
      assert.deepStrictEqual(vm.colWidth(), [64, 150, 200]);
    });
  });

  it("should not allow toggling view modes for non-foreground statements", async () => {
    const explainStatement: FlinkStatement = new FlinkStatement({
      ...statement,
      status: {
        ...statement.status,
        traits: {
          ...statement.status.traits,
          sql_kind: "EXPLAIN",
        },
      },
    });
    const { vm, ctx } = await createTestResultsManagerContext(sandbox, explainStatement);
    try {
      assert.equal(vm.viewMode(), "table");

      // Try changing view mode
      await vm.setViewMode("changelog");

      // No effect
      assert.equal(vm.viewMode(), "table");
    } finally {
      ctx.manager.dispose();
      vm.dispose();
    }
  });
});

describe("flinkStatementResultsManager.ts transientBackoffWindow()", () => {
  function responseWithHeaders(headers: Record<string, string>): Response {
    return new Response("{}", { status: 429, headers });
  }

  it("should honor a Retry-After the server sends, never shortening it", () => {
    const { minMs, maxMs } = transientBackoffWindow(responseWithHeaders({ "retry-after": "2" }), 0);

    assert.equal(minMs, 2000);
    assert.ok(maxMs > minMs, "jitter should only extend a server-requested delay");
  });

  it("should cap an outsized Retry-After", () => {
    const { minMs } = transientBackoffWindow(responseWithHeaders({ "retry-after": "600" }), 0);

    assert.equal(minMs, 8000);
  });

  it("should fall back to X-RateLimit-Reset when a 429 omits Retry-After", () => {
    const { minMs } = transientBackoffWindow(
      responseWithHeaders({ "x-ratelimit-limit": "5", "x-ratelimit-reset": "3" }),
      0,
    );

    assert.equal(minMs, 3000);
  });

  it("should prefer Retry-After over X-RateLimit-Reset when both are present", () => {
    const { minMs } = transientBackoffWindow(
      responseWithHeaders({ "retry-after": "1", "x-ratelimit-reset": "3" }),
      0,
    );

    assert.equal(minMs, 1000);
  });

  it("should fall back to an exponential curve without either header", () => {
    const windows = [0, 1, 2, 3].map((attempt) =>
      transientBackoffWindow(responseWithHeaders({}), attempt),
    );

    assert.deepEqual(
      windows.map((w) => w.maxMs),
      [500, 1000, 2000, 4000],
    );
    assert.deepEqual(
      windows.map((w) => w.minMs),
      [250, 500, 1000, 2000],
    );
  });

  it("should fall back to the curve for a non-numeric Retry-After", () => {
    // RFC 7231 also permits an HTTP-date, which we don't parse
    const { maxMs } = transientBackoffWindow(
      responseWithHeaders({ "retry-after": "Wed, 21 Oct 2015 07:28:00 GMT" }),
      0,
    );

    assert.equal(maxMs, 500);
  });
});
