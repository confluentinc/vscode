import * as assert from "assert";
import * as sinon from "sinon";
import {
  TEST_CCLOUD_KAFKA_CLUSTER,
  TEST_CCLOUD_SCHEMA_REGISTRY,
} from "../../../tests/unit/testResources";
import { getTestExtensionContext } from "../../../tests/unit/testUtils";
import { ContextValues, setContextValue } from "../../context/values";
import { currentKafkaClusterChanged, currentSchemaRegistryChanged } from "../../emitters";
import { getResourceManager } from "../../storage/resourceManager";
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

    const resourceManager = getResourceManager();
    const deleteCCloudResourcesStub = sandbox.stub(resourceManager, "deleteCCloudResources");
    const currentKafkaClusterChangedFireStub = sandbox.stub(currentKafkaClusterChanged, "fire");
    const currentSchemaRegistryChangedFireStub = sandbox.stub(currentSchemaRegistryChanged, "fire");

    // Set the view controllers to be focused on CCloud resources
    const topicViewProvider = TopicViewProvider.getInstance();
    const schemasViewProvider = SchemasViewProvider.getInstance();
    topicViewProvider.kafkaCluster = TEST_CCLOUD_KAFKA_CLUSTER;
    schemasViewProvider.schemaRegistry = TEST_CCLOUD_SCHEMA_REGISTRY;

    await clearCurrentCCloudResources();

    assert.ok(deleteCCloudResourcesStub.calledOnce);
    assert.ok(currentKafkaClusterChangedFireStub.calledOnceWith(null));
    assert.ok(currentSchemaRegistryChangedFireStub.calledOnceWith(null));

    // Reset the stubs
    deleteCCloudResourcesStub.resetHistory();
    currentKafkaClusterChangedFireStub.resetHistory();
    currentSchemaRegistryChangedFireStub.resetHistory();

    // Now set the view controllers to be focused on non-CCloud resources.
    // This should not fire any events, but still clear the resources.
    topicViewProvider.kafkaCluster = null;
    schemasViewProvider.schemaRegistry = null;

    await clearCurrentCCloudResources();

    assert.ok(deleteCCloudResourcesStub.calledOnce);
    assert.ok(currentKafkaClusterChangedFireStub.notCalled);
    assert.ok(currentSchemaRegistryChangedFireStub.notCalled);
  });

  it("hasCCloudAuthSession() should return false when the context value is false or undefined", () => {
    for (const value of [false, undefined]) {
      setContextValue(ContextValues.ccloudConnectionAvailable, value);
      assert.strictEqual(hasCCloudAuthSession(), false, `Expected ${value} to return false`);
    }
  });

  it("hasCCloudAuthSession() should return true when the context value is true", () => {
    setContextValue(ContextValues.ccloudConnectionAvailable, true);
    assert.strictEqual(hasCCloudAuthSession(), true);
  });
});
