import * as assert from "assert";
import * as sinon from "sinon";
import { TEST_CCLOUD_STATUS_SUMMARY } from "../../tests/unit/testResources/ccloudStatus";
import * as ccloudStatusBar from "../statusBar/ccloudItem";
import * as timing from "../utils/timing";
import * as api from "./api";
import {
  disableCCloudStatusPolling,
  enableCCloudStatusPolling,
  refreshCCloudStatus,
} from "./polling";

describe("ccloudStatus/polling.ts", () => {
  let sandbox: sinon.SinonSandbox;

  let stubbedIntervalPoller: sinon.SinonStubbedInstance<timing.IntervalPoller>;
  let fetchCCloudStatusStub: sinon.SinonStub;
  let updateCCloudStatusStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // stub the poller
    stubbedIntervalPoller = sandbox.createStubInstance(timing.IntervalPoller);
    sandbox.stub(timing, "IntervalPoller").returns(stubbedIntervalPoller);

    // stub the helper functions
    fetchCCloudStatusStub = sandbox.stub(api, "fetchCCloudStatus");
    updateCCloudStatusStub = sandbox.stub(ccloudStatusBar, "updateCCloudStatus");

    // reset the poller before each test
    disableCCloudStatusPolling();
  });

  afterEach(() => {
    // reset the poller after each test
    disableCCloudStatusPolling();
    sandbox.restore();
  });

  it("enableCCloudStatusPolling() should reuse the existing IntervalPoller and start it when called again", () => {
    const poller = enableCCloudStatusPolling();
    const samePoller = enableCCloudStatusPolling();

    assert.strictEqual(poller, samePoller);
    sinon.assert.calledOnce(stubbedIntervalPoller.start);
  });

  it("disableCCloudStatusPolling() should stop the poller and set it to undefined", () => {
    // create+start then poller, then stop it
    enableCCloudStatusPolling();

    disableCCloudStatusPolling();
    sinon.assert.calledOnce(stubbedIntervalPoller.stop);
  });

  it("disableCCloudStatusPolling() should do nothing if no poller exists", () => {
    // don't create/start a poller first
    disableCCloudStatusPolling();

    sinon.assert.notCalled(stubbedIntervalPoller.stop);
  });

  it("refreshCCloudStatus() should call updateCCloudStatus() when a valid status is fetched", async () => {
    fetchCCloudStatusStub.resolves(TEST_CCLOUD_STATUS_SUMMARY);

    await refreshCCloudStatus();

    sinon.assert.calledOnce(fetchCCloudStatusStub);
    sinon.assert.calledWith(updateCCloudStatusStub, TEST_CCLOUD_STATUS_SUMMARY);
  });

  it("refreshCCloudStatus() should not call updateCCloudStatus() when no status is fetched", async () => {
    // error thrown during fetch means we get `undefined` from fetchCCloudStatus
    fetchCCloudStatusStub.resolves(undefined);

    await refreshCCloudStatus();

    sinon.assert.calledOnce(fetchCCloudStatusStub);
    sinon.assert.notCalled(updateCCloudStatusStub);
  });
});
