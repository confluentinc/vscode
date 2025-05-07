import * as sinon from "sinon";
import { Uri, window, workspace } from "vscode";
import { TEST_CCLOUD_KAFKA_CLUSTER } from "../../tests/unit/testResources";
import { TEST_CCLOUD_FLINK_COMPUTE_POOL } from "../../tests/unit/testResources/flinkComputePool";
import { uriMetadataSet } from "../emitters";
import {
  FLINK_CONFIG_COMPUTE_POOL,
  FLINK_CONFIG_DATABASE,
  UPDATE_DEFAULT_DATABASE_FROM_LENS,
  UPDATE_DEFAULT_POOL_ID_FROM_LENS,
} from "../preferences/constants";
import * as updates from "../preferences/updates";
import * as flinkComputePoolsQuickPick from "../quickpicks/flinkComputePools";
import * as flinkDatabaseQuickpick from "../quickpicks/kafkaClusters";
import * as ccloudConnections from "../sidecar/connections/ccloud";
import { UriMetadataKeys } from "../storage/constants";
import { ResourceManager } from "../storage/resourceManager";
import {
  resetCCloudMetadataForUriCommand,
  setCCloudComputePoolForUriCommand,
  setCCloudDatabaseForUriCommand,
} from "./documents";

const testUri = Uri.parse("file:///path/to/test.sql");

describe("commands/documents.ts setCCloudComputePoolForUriCommand()", () => {
  let sandbox: sinon.SinonSandbox;

  let stubResourceManager: sinon.SinonStubbedInstance<ResourceManager>;
  let flinkComputePoolQuickPickStub: sinon.SinonStub;
  let uriMetadataSetFireStub: sinon.SinonStub;
  let updateDefaultFlinkPoolIdStub: sinon.SinonStub;
  let hasCCloudAuthSessionStub: sinon.SinonStub;

  let getConfigStub: sinon.SinonStub;
  let showInfoMessageStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    stubResourceManager = sandbox.createStubInstance(ResourceManager);
    sandbox.stub(ResourceManager, "getInstance").returns(stubResourceManager);
    flinkComputePoolQuickPickStub = sandbox.stub(
      flinkComputePoolsQuickPick,
      "flinkComputePoolQuickPick",
    );
    uriMetadataSetFireStub = sandbox.stub(uriMetadataSet, "fire");
    updateDefaultFlinkPoolIdStub = sandbox.stub(updates, "updateDefaultFlinkPoolId").resolves();
    // assume the user is signed in to CCloud for most tests
    hasCCloudAuthSessionStub = sandbox
      .stub(ccloudConnections, "hasCCloudAuthSession")
      .returns(true);

    // vscode stubs
    getConfigStub = sandbox.stub();
    sandbox.stub(workspace, "getConfiguration").returns({
      update: sandbox.stub(),
      get: getConfigStub,
      has: sandbox.stub(),
      inspect: sandbox.stub(),
    });
    // no updates or notifications for most tests
    getConfigStub.withArgs(UPDATE_DEFAULT_POOL_ID_FROM_LENS).returns("never");
    getConfigStub.withArgs(UPDATE_DEFAULT_DATABASE_FROM_LENS).returns("never");

    showInfoMessageStub = sandbox.stub(window, "showInformationMessage");
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
  });

  it("should do nothing when no CCloud auth session is available", async () => {
    // simulate user not being signed in to CCloud
    hasCCloudAuthSessionStub.returns(false);

    await setCCloudComputePoolForUriCommand(testUri);

    sinon.assert.notCalled(flinkComputePoolQuickPickStub);
    sinon.assert.notCalled(stubResourceManager.setUriMetadataValue);
    sinon.assert.notCalled(uriMetadataSetFireStub);
  });

  it("should do nothing when compute pool quickpick is cancelled", async () => {
    // simulate user cancelling the quick pick
    flinkComputePoolQuickPickStub.resolves(undefined);

    await setCCloudComputePoolForUriCommand(testUri);

    sinon.assert.called(flinkComputePoolQuickPickStub);
    sinon.assert.notCalled(stubResourceManager.setUriMetadataValue);
    sinon.assert.notCalled(uriMetadataSetFireStub);
  });

  it("should set the compute pool metadata and fire event when compute pool is selected", async () => {
    // simulate user selecting a compute pool
    flinkComputePoolQuickPickStub.resolves(TEST_CCLOUD_FLINK_COMPUTE_POOL);

    await setCCloudComputePoolForUriCommand(testUri);

    sinon.assert.calledOnce(flinkComputePoolQuickPickStub);
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

  for (const notificationSetting of ["never", "always"]) {
    it(`should not show a notification to update the value of "${FLINK_CONFIG_COMPUTE_POOL}" if the user setting is "${notificationSetting}"`, async () => {
      getConfigStub.withArgs(UPDATE_DEFAULT_POOL_ID_FROM_LENS).returns(notificationSetting);
      // simulate user selecting a compute pool
      flinkComputePoolQuickPickStub.resolves(TEST_CCLOUD_FLINK_COMPUTE_POOL);

      await setCCloudComputePoolForUriCommand(testUri);

      sinon.assert.notCalled(showInfoMessageStub);
      // automatically update the default pool ID if the user setting is "always"
      // otherwise, do nothing
      if (notificationSetting === "always") {
        sinon.assert.calledOnce(updateDefaultFlinkPoolIdStub);
        sinon.assert.calledWithExactly(
          updateDefaultFlinkPoolIdStub,
          TEST_CCLOUD_FLINK_COMPUTE_POOL,
        );
      } else {
        sinon.assert.notCalled(updateDefaultFlinkPoolIdStub);
      }
    });
  }

  it(`should show a notification to update the value of "${FLINK_CONFIG_COMPUTE_POOL}" if the user setting is 'ask'`, async () => {
    getConfigStub.withArgs(UPDATE_DEFAULT_POOL_ID_FROM_LENS).returns("ask");
    // simulate user selecting a compute pool
    flinkComputePoolQuickPickStub.resolves(TEST_CCLOUD_FLINK_COMPUTE_POOL);
    // user dismisses the notification (default behavior)

    await setCCloudComputePoolForUriCommand(testUri);

    sinon.assert.calledOnce(showInfoMessageStub);
    sinon.assert.notCalled(updateDefaultFlinkPoolIdStub);
  });

  it(`should show a notification to update the value of "${FLINK_CONFIG_COMPUTE_POOL}" if the user setting is 'ask' and update the default when the user clicks 'yes'`, async () => {
    getConfigStub.withArgs(UPDATE_DEFAULT_POOL_ID_FROM_LENS).returns("ask");
    // simulate user selecting a compute pool
    flinkComputePoolQuickPickStub.resolves(TEST_CCLOUD_FLINK_COMPUTE_POOL);
    // and clicking "Yes" on the notification to update the default pool ID
    showInfoMessageStub.resolves("Yes");

    await setCCloudComputePoolForUriCommand(testUri);

    sinon.assert.calledOnce(showInfoMessageStub);
    sinon.assert.calledOnce(updateDefaultFlinkPoolIdStub);
    sinon.assert.calledWithExactly(updateDefaultFlinkPoolIdStub, TEST_CCLOUD_FLINK_COMPUTE_POOL);
  });
});

describe("commands/documents.ts setCCloudDatabaseForUriCommand()", () => {
  let sandbox: sinon.SinonSandbox;

  let stubResourceManager: sinon.SinonStubbedInstance<ResourceManager>;
  let flinkComputePoolQuickPickStub: sinon.SinonStub;
  let flinkDatabaseQuickpickStub: sinon.SinonStub;
  let uriMetadataSetFireStub: sinon.SinonStub;
  let hasCCloudAuthSessionStub: sinon.SinonStub;
  let updateDefaultDatabaseIdStub: sinon.SinonStub;

  let getConfigStub: sinon.SinonStub;
  let showInfoMessageStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    stubResourceManager = sandbox.createStubInstance(ResourceManager);
    sandbox.stub(ResourceManager, "getInstance").returns(stubResourceManager);
    flinkComputePoolQuickPickStub = sandbox.stub(
      flinkComputePoolsQuickPick,
      "flinkComputePoolQuickPick",
    );
    flinkDatabaseQuickpickStub = sandbox.stub(flinkDatabaseQuickpick, "flinkDatabaseQuickpick");
    uriMetadataSetFireStub = sandbox.stub(uriMetadataSet, "fire");
    updateDefaultDatabaseIdStub = sandbox.stub(updates, "updateDefaultFlinkDatabaseId").resolves();
    // assume the user is signed in to CCloud for most tests
    hasCCloudAuthSessionStub = sandbox
      .stub(ccloudConnections, "hasCCloudAuthSession")
      .returns(true);

    // vscode stubs
    getConfigStub = sandbox.stub();
    sandbox.stub(workspace, "getConfiguration").returns({
      update: sandbox.stub(),
      get: getConfigStub,
      has: sandbox.stub(),
      inspect: sandbox.stub(),
    });
    // no updates or notifications for most tests
    getConfigStub.withArgs(UPDATE_DEFAULT_POOL_ID_FROM_LENS).returns("never");
    getConfigStub.withArgs(UPDATE_DEFAULT_DATABASE_FROM_LENS).returns("never");

    showInfoMessageStub = sandbox.stub(window, "showInformationMessage");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should do nothing when no Uri is provided", async () => {
    // no uri argument passed here:
    await setCCloudDatabaseForUriCommand();

    sinon.assert.notCalled(flinkComputePoolQuickPickStub);
    sinon.assert.notCalled(stubResourceManager.setUriMetadataValue);
    sinon.assert.notCalled(uriMetadataSetFireStub);
  });

  it("should do nothing when no CCloud auth session is available", async () => {
    // simulate user not being signed in to CCloud
    hasCCloudAuthSessionStub.returns(false);

    await setCCloudComputePoolForUriCommand(testUri);

    sinon.assert.notCalled(flinkComputePoolQuickPickStub);
    sinon.assert.notCalled(stubResourceManager.setUriMetadataValue);
    sinon.assert.notCalled(uriMetadataSetFireStub);
  });

  it("should do nothing when compute pool quickpick is cancelled", async () => {
    // simulate user cancelling the quick pick
    flinkComputePoolQuickPickStub.resolves(undefined);

    await setCCloudDatabaseForUriCommand(testUri);

    sinon.assert.called(flinkComputePoolQuickPickStub);
    sinon.assert.notCalled(stubResourceManager.setUriMetadataValue);
    sinon.assert.notCalled(uriMetadataSetFireStub);
  });

  it("should set the database ID metadata and fire event when database is selected", async () => {
    // simulate user selecting a compute pool and database
    flinkComputePoolQuickPickStub.resolves(TEST_CCLOUD_FLINK_COMPUTE_POOL);
    flinkDatabaseQuickpickStub.resolves(TEST_CCLOUD_KAFKA_CLUSTER);

    await setCCloudDatabaseForUriCommand(testUri);

    sinon.assert.calledOnce(flinkComputePoolQuickPickStub);
    sinon.assert.calledOnce(stubResourceManager.setUriMetadataValue);
    // all metadata should be derived from the chosen compute pool
    sinon.assert.calledWithExactly(
      stubResourceManager.setUriMetadataValue,
      testUri,
      UriMetadataKeys.FLINK_DATABASE_ID,
      TEST_CCLOUD_KAFKA_CLUSTER.id,
    );
    sinon.assert.calledOnce(uriMetadataSetFireStub);
    sinon.assert.calledOnceWithExactly(uriMetadataSetFireStub, testUri);
  });

  it("should skip the compute pool quickpick when a pool is provided", async () => {
    // simulate user selecting a database
    flinkDatabaseQuickpickStub.resolves(TEST_CCLOUD_KAFKA_CLUSTER);

    await setCCloudDatabaseForUriCommand(testUri, TEST_CCLOUD_FLINK_COMPUTE_POOL);

    sinon.assert.notCalled(flinkComputePoolQuickPickStub);
    sinon.assert.calledOnce(stubResourceManager.setUriMetadataValue);
    // all metadata should be derived from the chosen compute pool
    sinon.assert.calledWithExactly(
      stubResourceManager.setUriMetadataValue,
      testUri,
      UriMetadataKeys.FLINK_DATABASE_ID,
      TEST_CCLOUD_KAFKA_CLUSTER.id,
    );
    sinon.assert.calledOnce(uriMetadataSetFireStub);
    sinon.assert.calledOnceWithExactly(uriMetadataSetFireStub, testUri);
  });

  for (const notificationSetting of ["never", "always"]) {
    it(`should not show a notification to update the value of "${FLINK_CONFIG_DATABASE}" if the user setting is "${notificationSetting}"`, async () => {
      getConfigStub.withArgs(UPDATE_DEFAULT_DATABASE_FROM_LENS).returns(notificationSetting);
      // simulate user selecting a compute pool and database
      flinkComputePoolQuickPickStub.resolves(TEST_CCLOUD_FLINK_COMPUTE_POOL);
      flinkDatabaseQuickpickStub.resolves(TEST_CCLOUD_KAFKA_CLUSTER);

      await setCCloudDatabaseForUriCommand(testUri);

      sinon.assert.notCalled(showInfoMessageStub);
      // automatically update the default database ID if the user setting is "always"
      // otherwise, do nothing
      if (notificationSetting === "always") {
        sinon.assert.calledOnce(updateDefaultDatabaseIdStub);
        sinon.assert.calledWithExactly(updateDefaultDatabaseIdStub, TEST_CCLOUD_KAFKA_CLUSTER);
      } else {
        sinon.assert.notCalled(updateDefaultDatabaseIdStub);
      }
    });
  }

  it(`should show a notification to update the value of "${FLINK_CONFIG_DATABASE}" if the user setting is 'ask'`, async () => {
    getConfigStub.withArgs(UPDATE_DEFAULT_DATABASE_FROM_LENS).returns("ask");
    // simulate user selecting a compute pool and database
    flinkComputePoolQuickPickStub.resolves(TEST_CCLOUD_FLINK_COMPUTE_POOL);
    flinkDatabaseQuickpickStub.resolves(TEST_CCLOUD_KAFKA_CLUSTER);
    // user dismisses the notification (default behavior)

    await setCCloudDatabaseForUriCommand(testUri);

    sinon.assert.calledOnce(showInfoMessageStub);
    sinon.assert.notCalled(updateDefaultDatabaseIdStub);
  });

  it(`should show a notification to update the value of "${FLINK_CONFIG_DATABASE}" if the user setting is 'ask' and update the default when the user clicks 'yes'`, async () => {
    getConfigStub.withArgs(UPDATE_DEFAULT_DATABASE_FROM_LENS).returns("ask");
    // simulate user selecting a compute pool and database
    flinkComputePoolQuickPickStub.resolves(TEST_CCLOUD_FLINK_COMPUTE_POOL);
    flinkDatabaseQuickpickStub.resolves(TEST_CCLOUD_KAFKA_CLUSTER);
    // and clicking "Yes" on the notification to update the default pool ID
    showInfoMessageStub.resolves("Yes");

    await setCCloudDatabaseForUriCommand(testUri);

    sinon.assert.calledOnce(showInfoMessageStub);
    sinon.assert.calledOnce(updateDefaultDatabaseIdStub);
    sinon.assert.calledWithExactly(updateDefaultDatabaseIdStub, TEST_CCLOUD_KAFKA_CLUSTER);
  });
});

describe("commands/documents.ts resetCCloudMetadataForUriCommand()", () => {
  let sandbox: sinon.SinonSandbox;

  let stubResourceManager: sinon.SinonStubbedInstance<ResourceManager>;
  let uriMetadataSetFireStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    stubResourceManager = sandbox.createStubInstance(ResourceManager);
    sandbox.stub(ResourceManager, "getInstance").returns(stubResourceManager);

    uriMetadataSetFireStub = sandbox.stub(uriMetadataSet, "fire");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should do nothing when no Uri is provided", async () => {
    // no uri argument passed here:
    await resetCCloudMetadataForUriCommand();

    sinon.assert.notCalled(stubResourceManager.setUriMetadata);
    sinon.assert.notCalled(uriMetadataSetFireStub);
  });

  it("should reset the metadata and fire event when a Uri is provided", async () => {
    await resetCCloudMetadataForUriCommand(testUri);

    sinon.assert.calledOnce(stubResourceManager.setUriMetadata);
    sinon.assert.calledWithExactly(stubResourceManager.setUriMetadata, testUri, {
      [UriMetadataKeys.FLINK_DATABASE_ID]: null,
      [UriMetadataKeys.FLINK_COMPUTE_POOL_ID]: null,
    });
    sinon.assert.calledOnce(uriMetadataSetFireStub);
    sinon.assert.calledOnceWithExactly(uriMetadataSetFireStub, testUri);
  });
});
