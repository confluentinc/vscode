import * as assert from "assert";
import sinon from "sinon";
import { TEST_CCLOUD_STATUS_SUMMARY } from "../../tests/unit/testResources/ccloudStatus";
import * as errors from "../errors";
import { fetchCCloudStatus } from "./api";
import * as types from "./types";

describe("ccloudStatus/api.ts fetchCCloudStatus()", () => {
  let sandbox: sinon.SinonSandbox;

  let fetchStub: sinon.SinonStub;
  let summaryFromJSONStub: sinon.SinonStub;
  let logErrorStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // stub the actual fetching
    fetchStub = sandbox.stub(global, "fetch");

    // stub helper functions
    summaryFromJSONStub = sandbox.stub(types, "CCloudStatusSummaryFromJSON");
    logErrorStub = sandbox.stub(errors, "logError");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should return a CCloudStatusSummary from a successful response", async () => {
    // JSON response data doesn't matter here since we're also stubbing the parsing function
    const fakeData = { key: "value" };
    const fakeResponse = new Response(JSON.stringify(fakeData), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    fetchStub.resolves(fakeResponse);
    summaryFromJSONStub.returns(TEST_CCLOUD_STATUS_SUMMARY);

    const result: types.CCloudStatusSummary | undefined = await fetchCCloudStatus();

    assert.strictEqual(result, TEST_CCLOUD_STATUS_SUMMARY);
    sinon.assert.calledWith(summaryFromJSONStub, fakeData);
    sinon.assert.notCalled(logErrorStub);
  });

  it("should return undefined and call logError() on a bad response", async () => {
    const fakeResponse = new Response("Bad Request", {
      status: 400,
      statusText: "Bad Request",
      headers: { "Content-Type": "application/json" },
    });
    fetchStub.resolves(fakeResponse);

    const result: types.CCloudStatusSummary | undefined = await fetchCCloudStatus();

    assert.strictEqual(result, undefined);
    sinon.assert.calledOnce(logErrorStub);
    sinon.assert.calledWithMatch(
      logErrorStub,
      sinon.match
        .instanceOf(Error)
        .and(sinon.match.has("message", "Failed to fetch Confluent Cloud status: 400 Bad Request")),
      "CCloud status",
      { extra: { functionName: "fetchCCloudStatus" } },
    );
  });

  it("should return undefined and not call logError due to a 'fetch failed' error", async () => {
    const networkError = new TypeError("fetch failed");
    fetchStub.rejects(networkError);

    const result: types.CCloudStatusSummary | undefined = await fetchCCloudStatus();

    assert.strictEqual(result, undefined);
    sinon.assert.notCalled(logErrorStub);
  });

  it("should return undefined and call logError when json parsing fails", async () => {
    const fakeResponse = new Response(JSON.stringify("not json data"), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    fetchStub.resolves(fakeResponse);
    const parsingError = new Error("Invalid JSON");
    summaryFromJSONStub.throws(parsingError);

    const result: types.CCloudStatusSummary | undefined = await fetchCCloudStatus();

    assert.strictEqual(result, undefined);
    sinon.assert.calledWith(logErrorStub, parsingError, "CCloud status", {
      extra: { functionName: "fetchCCloudStatus" },
    });
  });

  it("should return undefined and log error for other unexpected errors", async () => {
    const unexpectedError = new Error("Unexpected error");
    fetchStub.rejects(unexpectedError);

    const result: types.CCloudStatusSummary | undefined = await fetchCCloudStatus();

    assert.strictEqual(result, undefined);
    sinon.assert.calledWith(logErrorStub, unexpectedError, "CCloud status", {
      extra: { functionName: "fetchCCloudStatus" },
    });
  });
});
