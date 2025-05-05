import * as sinon from "sinon";
import { Uri } from "vscode";
import { TEST_CCLOUD_KAFKA_CLUSTER } from "../../tests/unit/testResources";
import { TEST_CCLOUD_FLINK_COMPUTE_POOL } from "../../tests/unit/testResources/flinkComputePool";
import { uriMetadataSet } from "../emitters";
import * as flinkComputePoolsQuickPick from "../quickpicks/flinkComputePools";
import * as flinkDatabaseQuickpick from "../quickpicks/kafkaClusters";
import { UriMetadataKeys } from "../storage/constants";
import { ResourceManager } from "../storage/resourceManager";
import {
  resetCCloudMetadataForUriCommand,
  setCCloudComputePoolForUriCommand,
  setCCloudDatabaseForUriCommand,
} from "./documents";

describe("commands/documents.ts setCCloudComputePoolForUriCommand()", () => {
  let sandbox: sinon.SinonSandbox;

  let stubResourceManager: sinon.SinonStubbedInstance<ResourceManager>;
  let flinkComputePoolQuickPickStub: sinon.SinonStub;
  let uriMetadataSetFireStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    stubResourceManager = sandbox.createStubInstance(ResourceManager);
    sandbox.stub(ResourceManager, "getInstance").returns(stubResourceManager);

    flinkComputePoolQuickPickStub = sandbox.stub(
      flinkComputePoolsQuickPick,
      "flinkComputePoolQuickPick",
    );
    uriMetadataSetFireStub = sandbox.stub(uriMetadataSet, "fire");
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

  it("should do nothing when compute pool quickpick is cancelled", async () => {
    // simulate user cancelling the quick pick
    flinkComputePoolQuickPickStub.resolves(undefined);

    const testUri = Uri.parse("file:///path/to/test.sql");
    await setCCloudComputePoolForUriCommand(testUri);

    sinon.assert.called(flinkComputePoolQuickPickStub);
    sinon.assert.notCalled(stubResourceManager.setUriMetadataValue);
    sinon.assert.notCalled(uriMetadataSetFireStub);
  });

  it("should set the compute pool metadata and fire event when compute pool is selected", async () => {
    // simulate user selecting a compute pool
    flinkComputePoolQuickPickStub.resolves(TEST_CCLOUD_FLINK_COMPUTE_POOL);
    const testUri = Uri.parse("file:///path/to/test.sql");

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
});

describe("commands/documents.ts setCCloudDatabaseForUriCommand()", () => {
  let sandbox: sinon.SinonSandbox;

  let stubResourceManager: sinon.SinonStubbedInstance<ResourceManager>;
  let flinkComputePoolQuickPickStub: sinon.SinonStub;
  let flinkDatabaseQuickpickStub: sinon.SinonStub;
  let uriMetadataSetFireStub: sinon.SinonStub;

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

  it("should do nothing when compute pool quickpick is cancelled", async () => {
    // simulate user cancelling the quick pick
    flinkComputePoolQuickPickStub.resolves(undefined);

    const testUri = Uri.parse("file:///path/to/test.sql");
    await setCCloudDatabaseForUriCommand(testUri);

    sinon.assert.called(flinkComputePoolQuickPickStub);
    sinon.assert.notCalled(stubResourceManager.setUriMetadataValue);
    sinon.assert.notCalled(uriMetadataSetFireStub);
  });

  it("should set the database ID metadata and fire event when database is selected", async () => {
    // simulate user selecting a compute pool and database
    flinkComputePoolQuickPickStub.resolves(TEST_CCLOUD_FLINK_COMPUTE_POOL);
    flinkDatabaseQuickpickStub.resolves(TEST_CCLOUD_KAFKA_CLUSTER);
    const testUri = Uri.parse("file:///path/to/test.sql");

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
    const testUri = Uri.parse("file:///path/to/test.sql");

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

    sinon.assert.notCalled(stubResourceManager.deleteUriMetadata);
    sinon.assert.notCalled(uriMetadataSetFireStub);
  });

  it("should reset the metadata and fire event when a Uri is provided", async () => {
    const testUri = Uri.parse("file:///path/to/test.sql");

    await resetCCloudMetadataForUriCommand(testUri);

    sinon.assert.calledOnce(stubResourceManager.deleteUriMetadata);
    sinon.assert.calledWithExactly(stubResourceManager.deleteUriMetadata, testUri);
    sinon.assert.calledOnce(uriMetadataSetFireStub);
    sinon.assert.calledOnceWithExactly(uriMetadataSetFireStub, testUri);
  });
});
