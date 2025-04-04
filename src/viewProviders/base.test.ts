import * as assert from "assert";
import * as sinon from "sinon";
import { Disposable, EventEmitter, TreeItem, window } from "vscode";
import { TEST_CCLOUD_ENVIRONMENT } from "../../tests/unit/testResources/environments";
import { TEST_CCLOUD_FLINK_COMPUTE_POOL } from "../../tests/unit/testResources/flinkComputePool";
import { TEST_CCLOUD_FLINK_STATEMENT } from "../../tests/unit/testResources/flinkStatement";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import { ConnectionType } from "../clients/sidecar";
import * as contextValues from "../context/values";
import { ContextValues } from "../context/values";
import { ccloudConnected } from "../emitters";
import { CCloudResourceLoader, ResourceLoader } from "../loaders";
import { CCloudFlinkComputePool, FlinkComputePool } from "../models/flinkComputePool";
import { FlinkStatement, FlinkStatementTreeItem } from "../models/flinkStatement";
import { BaseViewProvider } from "./base";

/** Sample view provider subclass for testing {@link BaseViewProvider}. */
class TestViewProvider extends BaseViewProvider<FlinkComputePool, FlinkStatement> {
  loggerName = "viewProviders.test";
  viewId = "confluent-test";

  async getChildren(element?: FlinkStatement): Promise<FlinkStatement[]> {
    const items = [
      TEST_CCLOUD_FLINK_STATEMENT,
      new FlinkStatement({
        ...TEST_CCLOUD_FLINK_STATEMENT,
        id: "statement1",
        status: "PENDING",
      }),
      new FlinkStatement({
        ...TEST_CCLOUD_FLINK_STATEMENT,
        id: "statement2",
        status: "STOPPED",
      }),
    ];

    return this.filterChildren(element, items);
  }

  getTreeItem(element: FlinkStatement): TreeItem {
    return new FlinkStatementTreeItem(element);
  }

  testEventEmitter: EventEmitter<void> = new EventEmitter<void>();
  handleCustomListenerCallback() {}

  protected setCustomEventListeners(): Disposable[] {
    const customListener: Disposable = this.testEventEmitter.event(() => {
      this.handleCustomListenerCallback();
    });
    return [customListener];
  }
}

describe("viewProviders/base.ts BaseViewProvider getInstance()", () => {
  let sandbox: sinon.SinonSandbox;

  before(async () => {
    // required for all subclasses of BaseViewProvider since they deal with extension storage
    await getTestExtensionContext();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
    // reset singleton instances between tests
    BaseViewProvider["instanceMap"].clear();
  });

  it("should return a singleton instance", () => {
    const provider = TestViewProvider.getInstance();
    const providerAgain = TestViewProvider.getInstance();

    assert.strictEqual(provider, providerAgain);
  });

  it("should initialize the provider with a subclass-named logger", () => {
    const provider = TestViewProvider.getInstance();

    assert.ok(provider.logger);
    assert.strictEqual(provider.logger["name"], "viewProviders.test");
  });

  it("should create a tree view with the correct ID", () => {
    const createTreeViewStub = sandbox.stub(window, "createTreeView");

    const provider = TestViewProvider.getInstance();

    sinon.assert.calledOnce(createTreeViewStub);
    sinon.assert.calledWith(createTreeViewStub, provider.viewId, { treeDataProvider: provider });
  });
});

describe("viewProviders/base.ts BaseViewProvider event listeners", () => {
  let sandbox: sinon.SinonSandbox;

  before(async () => {
    // required for all subclasses of BaseViewProvider since they deal with extension storage
    await getTestExtensionContext();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
    // reset singleton instances between tests
    BaseViewProvider["instanceMap"].clear();
  });

  it("should include custom event listeners in disposables", () => {
    const provider = TestViewProvider.getInstance();

    // one for the custom event listener, and any implemented in the base class as part of the
    // private `setEventListeners` method
    assert.ok(provider.disposables.length > 1);
  });

  it("should register the default ccloudConnected event listener", () => {
    const provider = TestViewProvider.getInstance();
    const handleSpy = sandbox.spy(provider, "handleCCloudConnectionChange");

    ccloudConnected.fire(true);

    assert.ok(handleSpy.calledOnce);
    assert.ok(handleSpy.calledWith(true));
  });

  it("handleCCloudConnectionChange() should call reset() when the `ccloudConnected` event fires and a CCloud resource is focused", () => {
    const provider = TestViewProvider.getInstance();
    const resetSpy = sandbox.spy(provider, "reset");

    // simulate CCloud connection state change
    provider.resource = TEST_CCLOUD_FLINK_COMPUTE_POOL;
    provider["handleCCloudConnectionChange"](false);

    sinon.assert.calledOnce(resetSpy);
    assert.strictEqual(provider.resource, null);
  });

  it("handleCCloudConnectionChange() should not call reset() when the `ccloudConnected` event fires and a non-CCloud resource is focused", () => {
    const provider = TestViewProvider.getInstance();
    const resetSpy = sandbox.spy(provider, "reset");

    // simulate a non-CCloud resource
    const fakeResource = {
      ...TEST_CCLOUD_FLINK_COMPUTE_POOL,
      connectionType: ConnectionType.Local,
    } as CCloudFlinkComputePool;
    provider.resource = fakeResource;
    provider.handleCCloudConnectionChange(false);

    sinon.assert.notCalled(resetSpy);
    assert.strictEqual(provider.resource, fakeResource);
  });
});

describe("viewProviders/base.ts BaseViewProvider updateTreeViewDescription()", () => {
  let sandbox: sinon.SinonSandbox;

  before(async () => {
    // required for all subclasses of BaseViewProvider since they deal with extension storage
    await getTestExtensionContext();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
    // reset singleton instances between tests
    BaseViewProvider["instanceMap"].clear();
  });

  it("should clear the description and clear .environment when no resource is focused", async () => {
    const provider = TestViewProvider.getInstance();
    provider.environment = TEST_CCLOUD_ENVIRONMENT;
    provider.resource = null;
    provider["treeView"].description = "this should go away";

    await provider.updateTreeViewDescription();

    assert.strictEqual(provider["treeView"].description, "");
    assert.strictEqual(provider.environment, null);
  });

  it("should set the description and set .environment when a resource is focused", async () => {
    // specifically stub the CCloudResourceLoader since the ResourceLoader's `getEnvironments`
    // (abstract) method is considered undefined here
    const loaderStub = sandbox.createStubInstance(CCloudResourceLoader);
    sandbox.stub(ResourceLoader, "getInstance").returns(loaderStub);
    loaderStub.getEnvironments.resolves([TEST_CCLOUD_ENVIRONMENT]);

    const provider = TestViewProvider.getInstance();
    provider.environment = TEST_CCLOUD_ENVIRONMENT;
    provider.resource = TEST_CCLOUD_FLINK_COMPUTE_POOL;
    provider["treeView"].description = "";

    await provider.updateTreeViewDescription();

    assert.strictEqual(
      provider["treeView"].description,
      `${TEST_CCLOUD_ENVIRONMENT.name} | ${TEST_CCLOUD_FLINK_COMPUTE_POOL.id}`,
    );
    assert.strictEqual(provider.environment, TEST_CCLOUD_ENVIRONMENT);
  });
});

describe("viewProviders/base.ts BaseViewProvider reset()", () => {
  let sandbox: sinon.SinonSandbox;

  before(async () => {
    // required for all subclasses of BaseViewProvider since they deal with extension storage
    await getTestExtensionContext();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
    // reset singleton instances between tests
    BaseViewProvider["instanceMap"].clear();
  });

  it("should reset focused resources and clear the tree view", async () => {
    const provider = TestViewProvider.getInstance();
    provider.environment = TEST_CCLOUD_ENVIRONMENT;
    provider.resource = TEST_CCLOUD_FLINK_COMPUTE_POOL;
    provider["treeView"].description = "this should go away";
    provider["treeView"].message = "this should go away too";

    await provider.reset();

    assert.strictEqual(provider.environment, null);
    assert.strictEqual(provider.resource, null);
    assert.strictEqual(provider["treeView"].description, undefined);
    assert.strictEqual(provider["treeView"].message, undefined);
  });

  it("should call .setSearch(null) to reset internal search state", async () => {
    const provider = TestViewProvider.getInstance();
    const setSearchSpy = sandbox.spy(provider, "setSearch");
    provider.searchContextValue = ContextValues.flinkStatementsSearchApplied;
    provider.itemSearchString = "running";
    provider.searchMatches.add(TEST_CCLOUD_FLINK_STATEMENT);
    provider.totalItemCount = 3;

    await provider.reset();

    // only check setSearch was called; other behavior is tested further down
    sinon.assert.calledOnce(setSearchSpy);
    sinon.assert.calledWith(setSearchSpy, null);
  });

  it("should refresh the tree view after resetting", async () => {
    const provider = TestViewProvider.getInstance();
    const refreshSpy = sandbox.spy(provider, "refresh");

    await provider.reset();

    sinon.assert.calledOnce(refreshSpy);
  });
});

describe("viewProviders/base.ts BaseViewProvider setSearch()", () => {
  let sandbox: sinon.SinonSandbox;
  let setContextValueStub: sinon.SinonStub;

  before(async () => {
    // required for all subclasses of BaseViewProvider since they deal with extension storage
    await getTestExtensionContext();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    setContextValueStub = sandbox.stub(contextValues, "setContextValue");
  });

  afterEach(() => {
    sandbox.restore();
    // reset singleton instances between tests
    BaseViewProvider["instanceMap"].clear();
  });

  it("should set internal search state when a value is passed", () => {
    const provider = TestViewProvider.getInstance();

    provider.setSearch("First");

    assert.strictEqual(provider.itemSearchString, "First");
    assert.strictEqual(provider.searchMatches.size, 0);
    assert.strictEqual(provider.totalItemCount, 0);
  });

  it("should clear internal search state when no value is passed", () => {
    const provider = TestViewProvider.getInstance();
    provider.itemSearchString = "running";
    provider.searchMatches.add(TEST_CCLOUD_FLINK_STATEMENT);
    provider.totalItemCount = 3;

    provider.setSearch(null);

    assert.strictEqual(provider.itemSearchString, null);
    assert.strictEqual(provider.searchMatches.size, 0);
    assert.strictEqual(provider.totalItemCount, 0);
  });

  for (const arg of ["First", null]) {
    it(`should update the search context value (arg=${arg}) when .searchContextValue is set`, () => {
      const provider = TestViewProvider.getInstance();
      // context value must be set for setContextValue to be called
      provider.searchContextValue = ContextValues.flinkStatementsSearchApplied;
      provider.setSearch(arg);

      sinon.assert.calledOnce(setContextValueStub);
      sinon.assert.calledWith(setContextValueStub, provider.searchContextValue, !!arg);
    });
  }

  for (const arg of ["First", null]) {
    it(`should not update the context value (arg=${arg}) when .searchContextValue is not set`, () => {
      const provider = TestViewProvider.getInstance();
      provider.setSearch(arg);

      sinon.assert.notCalled(setContextValueStub);
    });
  }

  it("should filter children based on search string", async () => {
    const provider = TestViewProvider.getInstance();
    provider.setSearch("first");

    const matchingStatement = new FlinkStatement({
      ...TEST_CCLOUD_FLINK_STATEMENT,
      id: "first-statement",
      status: "STOPPED",
    });
    const items = [
      matchingStatement,
      new FlinkStatement({
        ...TEST_CCLOUD_FLINK_STATEMENT,
        id: "second-statement",
        status: "PENDING",
      }),
    ];

    const filtered = provider.filterChildren(undefined, items);

    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].id, matchingStatement.id);
    assert.strictEqual(provider.searchMatches.size, 1);
    assert.strictEqual(provider.totalItemCount, 2);
  });

  it("should update tree view message with search results when filterChildren() is called", () => {
    const provider = TestViewProvider.getInstance();
    provider.setSearch("running");

    const items = [
      new FlinkStatement({
        ...TEST_CCLOUD_FLINK_STATEMENT,
        id: "first-statement",
        status: "RUNNING",
      }),
      new FlinkStatement({
        ...TEST_CCLOUD_FLINK_STATEMENT,
        id: "second-statement",
        status: "PENDING",
      }),
    ];

    provider.filterChildren(undefined, items);

    assert.ok(provider["treeView"].message);
    assert.strictEqual(
      provider["treeView"].message,
      `Showing ${provider.searchMatches.size} of ${provider.totalItemCount} results for "${provider.itemSearchString}"`,
    );
  });
});
