import * as assert from "assert";
import { ObservableScope } from "inertial";
import sinon from "sinon";
import { loadFixture } from "../tests/fixtures/utils";
import { StatementResultsSqlV1Api } from "./clients/flinkSql";
import { FlinkStatementResultsManager } from "./flinkStatementResultsManager";
import { FlinkStatement } from "./models/flinkStatement";
import { DEFAULT_RESULTS_LIMIT } from "./utils/flinkStatementResults";

describe("FlinkStatementResultsManager", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should process results from fixtures correctly", async () => {
    const os = ObservableScope();

    // Mock Service
    const mockService = sandbox.createStubInstance(StatementResultsSqlV1Api);

    // Read fixture files
    const createStatementResponse = loadFixture(
      "flink-statement-results-processing/create-statement-response.json",
    );

    // Load all statement results fixtures
    const statementResponses = Array.from({ length: 5 }, (_, i) =>
      loadFixture(`flink-statement-results-processing/get-statement-results-${i + 1}.json`),
    );

    // Load expected parsed results
    const expectedParsedResults = loadFixture(
      "flink-statement-results-processing/expected-parsed-results.json",
    );

    // Mock Statement
    const mockStatement = createStatementResponse as unknown as FlinkStatement;

    // Set up mock responses in sequence
    statementResponses.forEach((response, index) => {
      mockService.getSqlv1StatementResult.onCall(index).resolves(response);
    });

    // Calls provided async callback immediately, no scheduling.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const schedule_immediately = <T>(cb: () => Promise<T>, _signal?: AbortSignal) => cb();

    // Mock notifyUI
    const notifyUIStub = sandbox.stub();

    // Create manager instance
    const manager = new FlinkStatementResultsManager(
      os,
      mockStatement,
      mockService,
      schedule_immediately,
      notifyUIStub,
      DEFAULT_RESULTS_LIMIT,
    );

    // Wait for results to be processed
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Get all results through message handler
    const results = manager.handleMessage("GetResults", {
      page: 0,
      pageSize: DEFAULT_RESULTS_LIMIT,
    });

    // Verify the results match expected format
    assert.deepStrictEqual(results, { results: expectedParsedResults });
  });
});
