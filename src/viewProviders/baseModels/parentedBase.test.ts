import * as assert from "assert";
import * as sinon from "sinon";
import { EventEmitter, TreeItem } from "vscode";
import { getStubbedCCloudResourceLoader } from "../../../tests/stubs/resourceLoaders";
import { TEST_CCLOUD_ENVIRONMENT } from "../../../tests/unit/testResources/environments";
import { TEST_CCLOUD_FLINK_COMPUTE_POOL } from "../../../tests/unit/testResources/flinkComputePool";
import {
  makeStatus,
  TEST_CCLOUD_FLINK_STATEMENT,
} from "../../../tests/unit/testResources/flinkStatement";
import { getTestExtensionContext } from "../../../tests/unit/testUtils";
import { ConnectionType } from "../../clients/sidecar";
import * as contextValues from "../../context/values";
import { ContextValues } from "../../context/values";
import { CCloudResourceLoader } from "../../loaders";
import { CCloudFlinkComputePool, FlinkComputePool } from "../../models/flinkComputePool";
import { FlinkStatement, FlinkStatementTreeItem, Phase } from "../../models/flinkStatement";
import { BaseViewProvider } from "./base";
import { ParentedBaseViewProvider } from "./parentedBase";

/** Sample view provider subclass for testing {@link ParentedBaseViewProvider}. */
class TestParentedViewProvider extends ParentedBaseViewProvider<FlinkComputePool, FlinkStatement> {
  loggerName = "viewProviders.test.TestParentedViewProvider";
  viewId = "confluent-test";

  parentResourceChangedEmitter = new EventEmitter<FlinkComputePool | null>();
  parentResourceChangedContextValue = ContextValues.flinkStatementsPoolSelected;
  readonly kind = "test-parented-statements";

  getChildren(element?: FlinkStatement): FlinkStatement[] {
    // Always return three items.
    const items = [
      TEST_CCLOUD_FLINK_STATEMENT,
      new FlinkStatement({
        ...TEST_CCLOUD_FLINK_STATEMENT,
        name: "statement1",
        status: makeStatus(Phase.PENDING),
      }),
      new FlinkStatement({
        ...TEST_CCLOUD_FLINK_STATEMENT,
        name: "statement2",
        status: makeStatus(Phase.STOPPED),
      }),
    ];

    return this.filterChildren(element, items);
  }

  getTreeItem(element: FlinkStatement): TreeItem {
    return new FlinkStatementTreeItem(element);
  }
}

describe("viewProviders/base.ts ParentedBaseViewProvider", () => {
  let sandbox: sinon.SinonSandbox;
  let provider: TestParentedViewProvider;

  before(async () => {
    // required for all subclasses of BaseViewProvider since they deal with extension storage
    await getTestExtensionContext();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    provider = TestParentedViewProvider.getInstance();
  });

  afterEach(() => {
    // cleanup + reset singleton instances between tests
    provider.dispose();
    BaseViewProvider["instanceMap"].clear();

    sandbox.restore();
  });

  describe("event listeners", () => {
    it("handleCCloudConnectionChange() should call reset() when the `ccloudConnected` event fires and a CCloud resource is focused", () => {
      const resetSpy = sandbox.spy(provider, "reset");

      // simulate CCloud connection state change
      provider.resource = TEST_CCLOUD_FLINK_COMPUTE_POOL;
      provider["ccloudConnectedHandler"](false);

      sinon.assert.calledOnce(resetSpy);
      assert.strictEqual(provider.resource, null);
    });

    it("handleCCloudConnectionChange() should not call reset() when the `ccloudConnected` event fires and a non-CCloud resource is focused", () => {
      const resetSpy = sandbox.spy(provider, "reset");

      // simulate a non-CCloud resource
      const fakeResource = {
        ...TEST_CCLOUD_FLINK_COMPUTE_POOL,
        connectionType: ConnectionType.Local,
      } as CCloudFlinkComputePool;
      provider.resource = fakeResource;
      provider.ccloudConnectedHandler(false);

      sinon.assert.notCalled(resetSpy);
      assert.strictEqual(provider.resource, fakeResource);
    });
  });

  describe("updateTreeViewDescription()", () => {
    it("should clear the description and clear .environment when no resource is focused", async () => {
      provider.resource = null;
      provider["treeView"].description = "this should go away";

      await provider.updateTreeViewDescription();

      assert.strictEqual(provider["treeView"].description, "");
    });

    it("should set the description and set .environment when a resource is focused", async () => {
      // specifically stub the CCloudResourceLoader since the ResourceLoader's `getEnvironments`
      // (abstract) method is considered undefined here
      const stubbedLoader: sinon.SinonStubbedInstance<CCloudResourceLoader> =
        getStubbedCCloudResourceLoader(sandbox);
      stubbedLoader.getEnvironment.resolves(TEST_CCLOUD_ENVIRONMENT);

      provider.resource = TEST_CCLOUD_FLINK_COMPUTE_POOL;
      provider["treeView"].description = "";

      await provider.updateTreeViewDescription();

      assert.strictEqual(
        provider["treeView"].description,
        `${TEST_CCLOUD_ENVIRONMENT.name} | ${TEST_CCLOUD_FLINK_COMPUTE_POOL.id}`,
      );
    });

    it("Should set the description to empty when environment is not found within loader", async () => {
      const stubbedLoader: sinon.SinonStubbedInstance<CCloudResourceLoader> =
        getStubbedCCloudResourceLoader(sandbox);
      stubbedLoader.getEnvironments.resolves([]);

      provider.resource = TEST_CCLOUD_FLINK_COMPUTE_POOL;

      provider["treeView"].description = "this should go away";

      await provider.updateTreeViewDescription();

      assert.strictEqual(provider["treeView"].description, "");
    });
  });

  describe("reset()", () => {
    it("should clear the tree view AND focused resources", async () => {
      provider.resource = TEST_CCLOUD_FLINK_COMPUTE_POOL;
      provider["treeView"].description = "this should go away";
      provider["treeView"].message = "this should go away too";

      await provider.reset();

      assert.strictEqual(provider.resource, null);
      assert.strictEqual(provider["treeView"].description, undefined);
      assert.strictEqual(provider["treeView"].message, undefined);
    });
  });

  describe("setParentResource()", () => {
    let refreshStub: sinon.SinonStub;
    let setSearchStub: sinon.SinonStub;
    let setContextValueStub: sinon.SinonStub;
    let updateTreeViewDescriptionStub: sinon.SinonStub;

    beforeEach(() => {
      refreshStub = sandbox.stub(provider, "refresh");
      setSearchStub = sandbox.stub(provider, "setSearch");
      setContextValueStub = sandbox.stub(contextValues, "setContextValue");
      updateTreeViewDescriptionStub = sandbox.stub(provider, "updateTreeViewDescription");
    });

    it("Should handle setting to null", async () => {
      await provider.setParentResource(null);
      assert.strictEqual(provider.resource, null, "resource should be null");
      sinon.assert.calledOnce(refreshStub);
    });

    it("Should handle setting to a resource", async () => {
      const resource = TEST_CCLOUD_FLINK_COMPUTE_POOL;
      await provider.setParentResource(resource);
      assert.strictEqual(provider.resource, resource, "resource should be set");
      sinon.assert.calledOnce(refreshStub);
      sinon.assert.calledOnce(setSearchStub);
      sinon.assert.calledWith(setSearchStub, null);
      sinon.assert.calledOnce(updateTreeViewDescriptionStub);
      sinon.assert.calledOnce(setContextValueStub);
      sinon.assert.calledWith(
        setContextValueStub,
        provider.parentResourceChangedContextValue,
        true,
      );
    });

    it("Should be called when parentResourceChangedEmitter fires", () => {
      const resource = TEST_CCLOUD_FLINK_COMPUTE_POOL;
      const setParentResourceStub = sandbox.stub(provider, "setParentResource");

      // call setEventListeners() again so that
      // it will register setParentResourceStub as the handler.
      // @ts-expect-error protected method call.
      provider.setEventListeners();

      provider.parentResourceChangedEmitter.fire(resource);
      sinon.assert.calledOnce(setParentResourceStub);
      sinon.assert.calledWith(setParentResourceStub, resource);
    });
  });
});
