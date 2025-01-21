import * as assert from "assert";
import * as sinon from "sinon";
import { getTestExtensionContext } from "../../../tests/unit/testUtils";
import { ContextValues, setContextValue } from "../../context/values";
import { currentKafkaClusterChanged, currentSchemaRegistryChanged } from "../../emitters";
import { getResourceManager } from "../../storage/resourceManager";
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

    await clearCurrentCCloudResources();

    assert.ok(deleteCCloudResourcesStub.calledOnce);
    assert.ok(currentKafkaClusterChangedFireStub.calledOnceWith(null));
    assert.ok(currentSchemaRegistryChangedFireStub.calledOnceWith(null));
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
