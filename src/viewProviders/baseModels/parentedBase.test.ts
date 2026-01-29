import * as assert from "assert";
import type { SinonSandbox, SinonStubbedInstance } from "sinon";
import * as sinon from "sinon";
import type { TreeItem } from "vscode";
import { EventEmitter } from "vscode";
import type { AnyResourceLoader } from "../../../tests/stubs/resourceLoaders";
import {
  getStubbedCCloudResourceLoader,
  getStubbedDirectResourceLoader,
  getStubbedLocalResourceLoader,
} from "../../../tests/stubs/resourceLoaders";
import {
  createParentedTestResource,
  type TestParentedResource,
} from "../../../tests/unit/testResources/base";
import {
  TEST_CCLOUD_ENVIRONMENT,
  TEST_CCLOUD_PROVIDER,
  TEST_CCLOUD_REGION,
  TEST_DIRECT_ENVIRONMENT,
  TEST_LOCAL_ENVIRONMENT,
} from "../../../tests/unit/testResources/environments";
import { TEST_CCLOUD_FLINK_COMPUTE_POOL } from "../../../tests/unit/testResources/flinkComputePool";
import {
  makeStatus,
  TEST_CCLOUD_FLINK_STATEMENT,
} from "../../../tests/unit/testResources/flinkStatement";
import { getTestExtensionContext } from "../../../tests/unit/testUtils";
import { ConnectionType } from "../../connections";
import * as contextValues from "../../context/values";
import { ContextValues } from "../../context/values";
import type { Environment } from "../../models/environment";
import { CCloudFlinkComputePool } from "../../models/flinkComputePool";
import { FlinkStatement, FlinkStatementTreeItem, Phase } from "../../models/flinkStatement";
import { BaseViewProvider } from "./base";
import type { EnvironmentedBaseViewProviderData } from "./parentedBase";
import { ParentedBaseViewProvider } from "./parentedBase";

interface ConnectionTypeTestConfig {
  connectionType: ConnectionType;
  getStubbedLoader: (sandbox: SinonSandbox) => SinonStubbedInstance<AnyResourceLoader>;
  testEnvironment: Environment;
}

const CONNECTION_TYPE_CONFIGS: ConnectionTypeTestConfig[] = [
  {
    connectionType: ConnectionType.Ccloud,
    getStubbedLoader: getStubbedCCloudResourceLoader,
    testEnvironment: TEST_CCLOUD_ENVIRONMENT,
  },
  {
    connectionType: ConnectionType.Local,
    getStubbedLoader: getStubbedLocalResourceLoader,
    testEnvironment: TEST_LOCAL_ENVIRONMENT,
  },
  {
    connectionType: ConnectionType.Direct,
    getStubbedLoader: getStubbedDirectResourceLoader,
    testEnvironment: TEST_DIRECT_ENVIRONMENT,
  },
];

/** Sample view provider subclass for testing {@link ParentedBaseViewProvider}. */
class TestParentedViewProvider extends ParentedBaseViewProvider<
  EnvironmentedBaseViewProviderData,
  FlinkStatement
> {
  loggerName = "viewProviders.test.TestParentedViewProvider";
  viewId = "confluent-test";

  parentResourceChangedEmitter = new EventEmitter<EnvironmentedBaseViewProviderData | null>();
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

  describe("handleCCloudConnectionChange()", () => {
    let setParentResourceStub: sinon.SinonStub;

    beforeEach(() => {
      setParentResourceStub = sandbox.stub(provider, "setParentResource");
    });
    it("should call setParentResource(null) when the `ccloudConnected` event fires disconnected and a CCloud resource was focused", () => {
      // simulate CCloud connection logout when a compute pool was focused
      provider.resource = TEST_CCLOUD_FLINK_COMPUTE_POOL;
      provider["ccloudConnectedHandler"](false);

      sinon.assert.calledOnce(setParentResourceStub);
      sinon.assert.calledWith(setParentResourceStub, null);
    });

    it("should not call setParentResource() when the `ccloudConnected` event fires and a non-CCloud resource is focused", () => {
      // simulate a non-CCloud resource
      const fakeResource = {
        ...TEST_CCLOUD_FLINK_COMPUTE_POOL,
        connectionType: ConnectionType.Local,
      } as CCloudFlinkComputePool;
      provider.resource = fakeResource;
      provider.ccloudConnectedHandler(false);

      sinon.assert.notCalled(setParentResourceStub);
    });
  });

  describe("updateTreeViewDescription()", () => {
    it("should clear the description when no resource is focused", async () => {
      provider.resource = null;
      provider["treeView"].description = "this should go away";

      await provider.updateTreeViewDescription();

      assert.strictEqual(provider["treeView"].description, "");
    });

    for (const {
      connectionType,
      getStubbedLoader: getLoader,
      testEnvironment,
    } of CONNECTION_TYPE_CONFIGS) {
      const usingCCloudResource = connectionType === ConnectionType.Ccloud;

      describe(`${connectionType} resources`, () => {
        let stubbedLoader: SinonStubbedInstance<AnyResourceLoader>;
        let testResource: TestParentedResource;

        beforeEach(() => {
          stubbedLoader = getLoader(sandbox);
          stubbedLoader.getEnvironment.resolves(testEnvironment);

          // create a general test "parent" resource that one of our views would focus on
          testResource = createParentedTestResource("test-id", "test-resource", connectionType);
          provider.resource = testResource;
        });

        it("should include resource name and environment name", async () => {
          await provider.updateTreeViewDescription();

          const expectedParts = [testResource.name];
          if (usingCCloudResource) {
            expectedParts.push(`${TEST_CCLOUD_PROVIDER}/${TEST_CCLOUD_REGION}`);
          }
          expectedParts.push(testEnvironment.name);
          assert.strictEqual(provider["treeView"].description, expectedParts.join(" | "));
        });

        it("should omit environment name when environment is not found", async () => {
          stubbedLoader.getEnvironment.resolves(undefined);

          await provider.updateTreeViewDescription();

          const expectedParts = [testResource.name];
          if (usingCCloudResource) {
            expectedParts.push(`${TEST_CCLOUD_PROVIDER}/${TEST_CCLOUD_REGION}`);
          }
          assert.strictEqual(provider["treeView"].description, expectedParts.join(" | "));
        });

        it("should exclude resource name when withResourceName=false", async () => {
          await provider.updateTreeViewDescription({ withResourceName: false });

          const expectedParts: string[] = [];
          if (usingCCloudResource) {
            expectedParts.push(`${TEST_CCLOUD_PROVIDER}/${TEST_CCLOUD_REGION}`);
          }
          expectedParts.push(testEnvironment.name);
          assert.strictEqual(provider["treeView"].description, expectedParts.join(" | "));
        });

        if (usingCCloudResource) {
          it("should exclude provider/region when withCloudProviderRegion=false", async () => {
            await provider.updateTreeViewDescription({ withCloudProviderRegion: false });

            assert.strictEqual(
              provider["treeView"].description,
              `${testResource.name} | ${testEnvironment.name}`,
            );
          });
        } else {
          it("should never include provider/region for non-CCloud resources", async () => {
            await provider.updateTreeViewDescription({ withCloudProviderRegion: true });

            assert.strictEqual(
              provider["treeView"].description,
              `${testResource.name} | ${testEnvironment.name}`,
            );
          });
        }

        it("should exclude environment name and skip getEnvironment() when withEnvironmentName=false", async () => {
          await provider.updateTreeViewDescription({ withEnvironmentName: false });

          const expectedParts = [testResource.name];
          if (usingCCloudResource) {
            expectedParts.push(`${TEST_CCLOUD_PROVIDER}/${TEST_CCLOUD_REGION}`);
          }
          assert.strictEqual(provider["treeView"].description, expectedParts.join(" | "));
          sinon.assert.notCalled(stubbedLoader.getEnvironment);
        });

        it("should only include the resource name when other options are false", async () => {
          await provider.updateTreeViewDescription({
            withResourceName: true,
            withCloudProviderRegion: false,
            withEnvironmentName: false,
          });

          assert.strictEqual(provider["treeView"].description, testResource.name);
          sinon.assert.notCalled(stubbedLoader.getEnvironment);
        });
      });
    }
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

    it("Should handle setting from something to null", async () => {
      // As if was focused on something and then set to null
      provider.resource = TEST_CCLOUD_FLINK_COMPUTE_POOL;

      await provider.setParentResource(null);

      assert.strictEqual(provider.resource, null, "resource should be null");
      sinon.assert.calledOnce(setSearchStub); // reset search when parent resource changes
      sinon.assert.calledWith(setSearchStub, null);

      sinon.assert.calledOnce(refreshStub);
      sinon.assert.calledOnce(updateTreeViewDescriptionStub);
      sinon.assert.calledOnce(setContextValueStub);
      sinon.assert.calledWith(
        setContextValueStub,
        provider.parentResourceChangedContextValue,
        false,
      );
    });

    it("Should handle setting from null to a resource", async () => {
      // As if was focused on nothing and then set to something
      provider.resource = null;

      const resource = TEST_CCLOUD_FLINK_COMPUTE_POOL;
      await provider.setParentResource(resource);

      assert.strictEqual(provider.resource, resource, "resource should be set");
      sinon.assert.calledOnce(setSearchStub); // reset search when parent resource changes
      sinon.assert.calledWith(setSearchStub, null);

      sinon.assert.calledOnce(refreshStub);
      sinon.assert.calledOnce(updateTreeViewDescriptionStub);
      sinon.assert.calledOnce(setContextValueStub);
      sinon.assert.calledWith(
        setContextValueStub,
        provider.parentResourceChangedContextValue,
        true,
      );
      sinon.assert.callOrder(
        setSearchStub,
        setContextValueStub,
        refreshStub,
        updateTreeViewDescriptionStub,
      );
    });

    it("Should handle setting from one resource to a different resource", async () => {
      // As if was focused on something and then set to something else
      provider.resource = TEST_CCLOUD_FLINK_COMPUTE_POOL;

      const resource = new CCloudFlinkComputePool({
        ...TEST_CCLOUD_FLINK_COMPUTE_POOL,
        id: "different-id",
        name: "different-name",
      });
      await provider.setParentResource(resource);

      assert.strictEqual(provider.resource, resource, "resource should be set");
      sinon.assert.calledOnce(setSearchStub); // reset search when parent resource changes
      sinon.assert.calledWith(setSearchStub, null);

      sinon.assert.calledOnce(refreshStub);
      sinon.assert.calledOnce(updateTreeViewDescriptionStub);
      // was not-undefined -> not undefined, so should not change context value
      // (was set to true, remains true)
      sinon.assert.notCalled(setContextValueStub);
    });

    it("Should handle setting to the same resource (partial no-op)", async () => {
      // As if was focused on something and then set to the same thing
      const resource = TEST_CCLOUD_FLINK_COMPUTE_POOL;
      provider.resource = resource;

      await provider.setParentResource(resource);

      assert.strictEqual(provider.resource, resource, "resource should be unchanged");
      sinon.assert.notCalled(setSearchStub); // should not reset search when parent resource is unchanged
      sinon.assert.calledOnce(refreshStub);
      sinon.assert.calledOnce(updateTreeViewDescriptionStub);
      sinon.assert.notCalled(setContextValueStub); // should not change context when parent resource is unchanged
    });

    it("Should handle setting to the same resource by id and connection id equality (partial no-op)", async () => {
      // As if was focused on something and then set to the same thing
      const resource = TEST_CCLOUD_FLINK_COMPUTE_POOL;
      provider.resource = resource;

      // won't be same object reference, but should be considered "same" resource.
      const equivalentResource = new CCloudFlinkComputePool({
        ...TEST_CCLOUD_FLINK_COMPUTE_POOL,
      });

      await provider.setParentResource(equivalentResource);

      assert.strictEqual(provider.resource, resource, "resource should be unchanged");
      sinon.assert.notCalled(setSearchStub); // should not reset search when parent resource is unchanged
      sinon.assert.calledOnce(refreshStub);
      sinon.assert.calledOnce(updateTreeViewDescriptionStub);
      sinon.assert.notCalled(setContextValueStub); // should not change context when parent resource is unchanged
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
