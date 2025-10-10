import * as assert from "assert";
import * as sinon from "sinon";
import { getStubbedCCloudResourceLoader } from "../../../tests/stubs/resourceLoaders";
import {
  TEST_CCLOUD_KAFKA_CLUSTER,
  TEST_CCLOUD_SCHEMA_REGISTRY,
} from "../../../tests/unit/testResources";
import { getTestExtensionContext } from "../../../tests/unit/testUtils";
import { ContextValues, setContextValue } from "../../context/values";
import { schemasViewResourceChanged, topicsViewResourceChanged } from "../../emitters";
import { SchemasViewProvider } from "../../viewProviders/schemas";
import { TopicViewProvider } from "../../viewProviders/topics";
import { clearCurrentCCloudResources, hasCCloudAuthSession } from "./ccloud";

describe("sidecar/connections/ccloud.ts", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("clearCurrentCCloudResources() should clear resources and fire events", async () => {
    // just needed for this test, otherwise we'd put this in the before() block
    await getTestExtensionContext();

    const mockedCCLoudLoader = getStubbedCCloudResourceLoader(sandbox);

    const currentKafkaClusterChangedFireStub = sandbox.stub(topicsViewResourceChanged, "fire");
    const schemasViewResourceChangedFireStub = sandbox.stub(schemasViewResourceChanged, "fire");

    // Set the view controllers to be focused on CCloud resources
    const topicViewProvider = TopicViewProvider.getInstance();
    const schemasViewProvider = SchemasViewProvider.getInstance();
    topicViewProvider.kafkaCluster = TEST_CCLOUD_KAFKA_CLUSTER;
    schemasViewProvider.schemaRegistry = TEST_CCLOUD_SCHEMA_REGISTRY;

    await clearCurrentCCloudResources();

    sinon.assert.calledOnce(mockedCCLoudLoader.reset);
    assert.ok(currentKafkaClusterChangedFireStub.calledOnceWith(null));
    assert.ok(schemasViewResourceChangedFireStub.calledOnceWith(null));

    // Reset the stubs
    mockedCCLoudLoader.reset.resetHistory();
    currentKafkaClusterChangedFireStub.resetHistory();
    schemasViewResourceChangedFireStub.resetHistory();

    // Now set the view controllers to be focused on non-CCloud resources.
    // This should not fire any events, but still clear the resources.
    topicViewProvider.kafkaCluster = null;
    schemasViewProvider.schemaRegistry = null;

    await clearCurrentCCloudResources();

    sinon.assert.calledOnce(mockedCCLoudLoader.reset);
    sinon.assert.notCalled(currentKafkaClusterChangedFireStub);
    sinon.assert.notCalled(schemasViewResourceChangedFireStub);
  });

  for (const value of [false, undefined]) {
    it(`hasCCloudAuthSession() should return false when the context value is ${value}`, async () => {
      await setContextValue(ContextValues.ccloudConnectionAvailable, value);
      assert.strictEqual(hasCCloudAuthSession(), false, `Expected ${value} to return false`);
    });
  }

  it("hasCCloudAuthSession() should return true when the context value is true", async () => {
    await setContextValue(ContextValues.ccloudConnectionAvailable, true);
    assert.strictEqual(hasCCloudAuthSession(), true);
  });
});
