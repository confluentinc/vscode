import * as assert from "assert";
import * as sinon from "sinon";
import { Disposable, EventEmitter, TreeItem, window } from "vscode";
import { getStubbedCCloudResourceLoader } from "../../tests/stubs/resourceLoaders";
import { TEST_CCLOUD_ENVIRONMENT } from "../../tests/unit/testResources/environments";
import { TEST_CCLOUD_FLINK_COMPUTE_POOL } from "../../tests/unit/testResources/flinkComputePool";
import {
  createFlinkStatement,
  TEST_CCLOUD_FLINK_STATEMENT,
} from "../../tests/unit/testResources/flinkStatement";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import { SqlV1StatementStatus } from "../clients/flinkSql";
import { ConnectionType } from "../clients/sidecar";
import * as contextValues from "../context/values";
import { ContextValues } from "../context/values";
import { ccloudConnected } from "../emitters";
import { CCloudResourceLoader } from "../loaders";
import { CCloudFlinkComputePool, FlinkComputePool } from "../models/flinkComputePool";
import { FlinkStatement, FlinkStatementTreeItem, Phase } from "../models/flinkStatement";
import { BaseViewProvider } from "./base";

/** Sample view provider subclass for testing {@link BaseViewProvider}. */
class TestViewProvider extends BaseViewProvider<FlinkComputePool, FlinkStatement> {
  loggerName = "viewProviders.test";
  viewId = "confluent-test";

  parentResourceChangedEmitter = new EventEmitter<FlinkComputePool | null>();
  parentResourceChangedContextValue = ContextValues.flinkStatementsPoolSelected;
  readonly kind = "test";

  async getChildren(element?: FlinkStatement): Promise<FlinkStatement[]> {
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
    const stubbedLoader: sinon.SinonStubbedInstance<CCloudResourceLoader> =
      getStubbedCCloudResourceLoader(sandbox);
    stubbedLoader.getEnvironments.resolves([TEST_CCLOUD_ENVIRONMENT]);

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

describe("viewProviders/base.ts BaseViewProvider setParentResource()", () => {
  let sandbox: sinon.SinonSandbox;

  let provider: TestViewProvider;
  let refreshStub: sinon.SinonStub;
  let setSearchStub: sinon.SinonStub;
  let setContextValueStub: sinon.SinonStub;
  let updateTreeViewDescriptionStub: sinon.SinonStub;

  before(async () => {
    // required for all subclasses of BaseViewProvider since they deal with extension storage
    await getTestExtensionContext();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    provider = TestViewProvider.getInstance();
    refreshStub = sandbox.stub(provider, "refresh");
    setSearchStub = sandbox.stub(provider, "setSearch");
    setContextValueStub = sandbox.stub(contextValues, "setContextValue");
    updateTreeViewDescriptionStub = sandbox.stub(provider, "updateTreeViewDescription");
  });
  afterEach(() => {
    sandbox.restore();
    // reset singleton instances between tests
    BaseViewProvider["instanceMap"].clear();
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
    sinon.assert.calledWith(setContextValueStub, provider.parentResourceChangedContextValue, true);
  });

  it("Should be called when parentResourceChangedEmitter fires", async () => {
    const resource = TEST_CCLOUD_FLINK_COMPUTE_POOL;
    const setParentResourceStub = sandbox.stub(provider, "setParentResource");
    provider.parentResourceChangedEmitter.fire(resource);
    sinon.assert.calledOnce(setParentResourceStub);
    sinon.assert.calledWith(setParentResourceStub, resource);
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

  it("should set internal search state when a value is passed", async () => {
    const provider = TestViewProvider.getInstance();

    await provider.setSearch("First");

    assert.strictEqual(provider.itemSearchString, "First");
    assert.strictEqual(provider.searchMatches.size, 0);
    assert.strictEqual(provider.totalItemCount, 0);
  });

  it("should clear internal search state when no value is passed", async () => {
    const provider = TestViewProvider.getInstance();
    provider.itemSearchString = "running";
    provider.searchMatches.add(TEST_CCLOUD_FLINK_STATEMENT);
    provider.totalItemCount = 3;

    await provider.setSearch(null);

    assert.strictEqual(provider.itemSearchString, null);
    assert.strictEqual(provider.searchMatches.size, 0, "searchMatches should be cleared");
    assert.strictEqual(provider.totalItemCount, 3, "totalItemCount should not change");
  });

  for (const arg of ["First", null]) {
    it(`should update the search context value (arg=${arg}) when .searchContextValue is set`, async () => {
      const provider = TestViewProvider.getInstance();
      // context value must be set for setContextValue to be called
      provider.searchContextValue = ContextValues.flinkStatementsSearchApplied;
      await provider.setSearch(arg);

      sinon.assert.calledOnce(setContextValueStub);
      sinon.assert.calledWith(setContextValueStub, provider.searchContextValue, !!arg);
    });
  }

  for (const arg of ["First", null]) {
    it(`should not update the context value (arg=${arg}) when .searchContextValue is not set`, async () => {
      const provider = TestViewProvider.getInstance();
      await provider.setSearch(arg);

      sinon.assert.notCalled(setContextValueStub);
    });
  }

  for (const arg of ["First", null]) {
    it(`should repaint the tree view when search is set (arg=${arg})`, async () => {
      const provider = TestViewProvider.getInstance();
      const repaintSpy = sandbox.spy(provider["_onDidChangeTreeData"], "fire");

      await provider.setSearch(arg);
      // Would normally be called by the tree view when children are requested
      // after setSearch() but we call it directly here to get totalItemCount assigned.
      await provider.getChildren();

      assert.strictEqual(provider.itemSearchString, arg);
      assert.strictEqual(provider.searchMatches.size, 0);
      assert.strictEqual(provider.totalItemCount, 3);

      sinon.assert.calledOnce(repaintSpy);
    });
  }

  it("should filter children based on search string", async () => {
    const provider = TestViewProvider.getInstance();
    await provider.setSearch("first");

    const matchingStatement = new FlinkStatement({
      ...TEST_CCLOUD_FLINK_STATEMENT,
      name: "first-statement",
      status: makeStatus(Phase.STOPPED),
    });
    const items = [
      matchingStatement,
      new FlinkStatement({
        ...TEST_CCLOUD_FLINK_STATEMENT,
        name: "second-statement",
        status: makeStatus(Phase.PENDING),
      }),
    ];

    const filtered = provider.filterChildren(undefined, items);

    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].id, matchingStatement.id);
    assert.strictEqual(provider.searchMatches.size, 1);
    assert.strictEqual(provider.totalItemCount, 2);
  });

  it("should update tree view message with search results when filterChildren() is called", async () => {
    const provider = TestViewProvider.getInstance();
    await provider.setSearch("running");

    const items = [
      new FlinkStatement({
        ...TEST_CCLOUD_FLINK_STATEMENT,
        name: "first-statement",
        status: makeStatus(Phase.RUNNING),
      }),
      new FlinkStatement({
        ...TEST_CCLOUD_FLINK_STATEMENT,
        name: "second-statement",
        status: makeStatus(Phase.PENDING),
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

describe("viewProviders/base.ts BaseViewProvider searchChangedEmitter behavior", () => {
  let sandbox: sinon.SinonSandbox;

  let clock: sinon.SinonFakeTimers;
  const fakeEmitter = new EventEmitter<string | null>();

  before(async () => {
    await getTestExtensionContext();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    clock = sandbox.useFakeTimers();
  });

  afterEach(() => {
    sandbox.restore();
    BaseViewProvider["instanceMap"].clear();
  });

  it("should call setSearch and update state when searchChangedEmitter is set and fires", async () => {
    // create fake subclass that includes a searchChangedEmitter
    class EmitterTestProvider extends TestViewProvider {
      searchChangedEmitter = fakeEmitter;
    }
    const provider = EmitterTestProvider.getInstance();
    const setSearchSpy = sandbox.spy(provider, "setSearch");

    const fakeSearch = "search-term";
    fakeEmitter.fire(fakeSearch);
    await clock.tickAsync(0);

    sinon.assert.calledWith(setSearchSpy, fakeSearch);
    assert.strictEqual(provider.itemSearchString, fakeSearch);
  });

  it("should not throw or fail if searchChangedEmitter is not set", async () => {
    // create fake subclass that doesn't include a searchChangedEmitter
    class NoEmitterTestProvider extends TestViewProvider {
      // searchChangedEmitter is null in TestViewProvider, so no need to override
    }
    const provider = NoEmitterTestProvider.getInstance();
    const setSearchSpy = sandbox.spy(provider, "setSearch");

    const fakeSearch = "search-term";
    fakeEmitter.fire(fakeSearch);
    await clock.tickAsync(0);

    sinon.assert.notCalled(setSearchSpy);
    assert.strictEqual(provider.itemSearchString, null);
  });
});

function makeStatus(phase: Phase): SqlV1StatementStatus {
  return createFlinkStatement({ phase: phase }).status;
}
