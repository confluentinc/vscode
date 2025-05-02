import * as sinon from "sinon";
import { Uri } from "vscode";
import { TEST_CCLOUD_FLINK_COMPUTE_POOL } from "../../tests/unit/testResources/flinkComputePool";
import { uriMetadataSet } from "../emitters";
import * as notifications from "../notifications";
import * as flinkComputePoolsQuickPick from "../quickpicks/flinkComputePools";
import { UriMetadataKeys } from "../storage/constants";
import { ResourceManager } from "../storage/resourceManager";
import { setCCloudComputePoolForUriCommand } from "./documents";

describe("commands/documents.ts setCCloudComputePoolForUriCommand()", () => {
  let sandbox: sinon.SinonSandbox;

  let stubResourceManager: sinon.SinonStubbedInstance<ResourceManager>;
  let flinkComputePoolQuickPickStub: sinon.SinonStub;
  let uriMetadataSetFireStub: sinon.SinonStub;
  let showErrorNotificationWithButtonsStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    stubResourceManager = sandbox.createStubInstance(ResourceManager);
    sandbox.stub(ResourceManager, "getInstance").returns(stubResourceManager);

    flinkComputePoolQuickPickStub = sandbox.stub(
      flinkComputePoolsQuickPick,
      "flinkComputePoolQuickPick",
    );
    uriMetadataSetFireStub = sandbox.stub(uriMetadataSet, "fire");
    showErrorNotificationWithButtonsStub = sandbox.stub(
      notifications,
      "showErrorNotificationWithButtons",
    );
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should do nothing when no Uri is provided", async () => {
    // no uri argument passed here:
    await setCCloudComputePoolForUriCommand();

    sinon.assert.notCalled(flinkComputePoolQuickPickStub);
    sinon.assert.notCalled(stubResourceManager.setUriMetadataValue);
    sinon.assert.notCalled(uriMetadataSetFireStub);
    sinon.assert.notCalled(showErrorNotificationWithButtonsStub);
  });

  it("should do nothing when compute pool quickpick is cancelled", async () => {
    // simulate user cancelling the quick pick
    flinkComputePoolQuickPickStub.resolves(undefined);

    const testUri = Uri.parse("file:///path/to/test.sql");
    await setCCloudComputePoolForUriCommand(testUri);

    sinon.assert.called(flinkComputePoolQuickPickStub);
    sinon.assert.notCalled(stubResourceManager.setUriMetadataValue);
    sinon.assert.notCalled(uriMetadataSetFireStub);
    sinon.assert.notCalled(showErrorNotificationWithButtonsStub);
  });

  it("should set the compute pool metadata and fire event when compute pool is selected", async () => {
    // simulate user selecting a compute pool
    flinkComputePoolQuickPickStub.resolves(TEST_CCLOUD_FLINK_COMPUTE_POOL);
    const testUri = Uri.parse("file:///path/to/test.sql");

    await setCCloudComputePoolForUriCommand(testUri);

    sinon.assert.calledOnce(flinkComputePoolQuickPickStub);
    sinon.assert.notCalled(showErrorNotificationWithButtonsStub);
    sinon.assert.calledOnce(stubResourceManager.setUriMetadataValue);
    // all metadata should be derived from the chosen compute pool
    sinon.assert.calledWithExactly(
      stubResourceManager.setUriMetadataValue,
      testUri,
      UriMetadataKeys.FLINK_COMPUTE_POOL_ID,
      TEST_CCLOUD_FLINK_COMPUTE_POOL.id,
    );
    sinon.assert.calledOnce(uriMetadataSetFireStub);
    sinon.assert.calledOnceWithExactly(uriMetadataSetFireStub, testUri);
  });
});
