import * as assert from "assert";
import { ObservableScope } from "inertial";
import sinon from "sinon";
import * as messageUtils from "../src/documentProviders/message";
import { loadFixture } from "../tests/fixtures/utils";
import { StatementResultsSqlV1Api } from "./clients/flinkSql";
import { FlinkStatementResultsManager } from "./flinkStatementResultsManager";
import { FlinkStatement } from "./models/flinkStatement";
import { DEFAULT_RESULTS_LIMIT } from "./utils/flinkStatementResults";

describe("FlinkStatementResultsManager", () => {
  let sandbox: sinon.SinonSandbox;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const schedule_immediately = <T>(cb: () => Promise<T>, _signal?: AbortSignal) => cb();

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  const createResultsManagerWithResults = async () => {
    const os = ObservableScope();

    const mockService = sandbox.createStubInstance(StatementResultsSqlV1Api);
    const createStatementResponse = loadFixture(
      "flink-statement-results-processing/create-statement-response.json",
    );
    const statementResponses = Array.from({ length: 5 }, (_, i) =>
      loadFixture(`flink-statement-results-processing/get-statement-results-${i + 1}.json`),
    );
    const expectedParsedResults = loadFixture(
      "flink-statement-results-processing/expected-parsed-results.json",
    );
    const mockStatement = createStatementResponse as unknown as FlinkStatement;

    statementResponses.forEach((response, index) => {
      mockService.getSqlv1StatementResult.onCall(index).resolves(response);
    });

    const notifyUIStub = sandbox.stub();

    const manager = new FlinkStatementResultsManager(
      os,
      mockStatement,
      mockService,
      schedule_immediately,
      notifyUIStub,
      DEFAULT_RESULTS_LIMIT,
    );
    // Wait for results to be processed
    await new Promise((resolve) => setTimeout(resolve, 150));
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

    // Verify PreviewAllResults functionality
    const previewResults = manager.handleMessage("PreviewAllResults", {});
    assert.deepStrictEqual(previewResults.results, { results: expectedParsedResults });
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
});
