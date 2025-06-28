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
import { BaseViewProvider, ParentedBaseViewProvider } from "./base";

/**
 * Sample view provider subclass for testing {@link BaseViewProvider}.
 * As if there was no `FlinkComputePool` parent resource, just random statements.
 */
class TestViewProvider extends BaseViewProvider<FlinkStatement> {
  loggerName = "viewProviders.test.TestViewProvider";
  viewId = "confluent-test-parentless-statements";

  readonly kind = "test-parentless-statements";

  getChildren(element?: FlinkStatement): FlinkStatement[] {
    // Always return two items.
    const items = [
      TEST_CCLOUD_FLINK_STATEMENT,
      new FlinkStatement({
        ...TEST_CCLOUD_FLINK_STATEMENT,
        name: "statement1",
        status: makeStatus(Phase.PENDING),
      }),
    ];

    return this.filterChildren(element, items);
  }

  getTreeItem(element: FlinkStatement): TreeItem {
    return new FlinkStatementTreeItem(element);
  }

  testEventEmitter: EventEmitter<void> = new EventEmitter<void>();
  testEventEmitterCalled: boolean = false;
  handleCustomListenerCallback() {
    this.testEventEmitterCalled = true;
  }

  setCustomEventListenersCalled = false;
  protected setCustomEventListeners(): Disposable[] {
    this.setCustomEventListenersCalled = true;
    const customListener: Disposable = this.testEventEmitter.event(() => {
      this.handleCustomListenerCallback();
    });
    return [customListener];
  }
}

describe("viewProviders/base.ts BaseViewProvider", () => {
  let sandbox: sinon.SinonSandbox;
  let provider: TestViewProvider;

  before(async () => {
    // required for all subclasses of BaseViewProvider since they deal with extension storage
    await getTestExtensionContext();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    provider = TestViewProvider.getInstance();
  });

  afterEach(() => {
    sandbox.restore();
    // reset singleton instances between tests
    BaseViewProvider["instanceMap"].clear();
  });

  describe("getInstance()", () => {
    it("should return a singleton instance", () => {
      const providerAgain = TestViewProvider.getInstance();

      assert.strictEqual(provider, providerAgain);
    });

    it("should initialize the provider with a subclass-named logger", () => {
      assert.ok(provider.logger);
      assert.strictEqual(provider.logger["name"], "viewProviders.test.TestViewProvider");
    });

    it("should create a tree view with the correct ID", () => {
      const createTreeViewStub = sandbox.stub(window, "createTreeView");

      // reset singleton instance
      BaseViewProvider["instanceMap"].clear();
      const newProvider = TestViewProvider.getInstance();

      sinon.assert.calledOnce(createTreeViewStub);
      sinon.assert.calledWith(createTreeViewStub, provider.viewId, {
        treeDataProvider: newProvider,
      });
    });
  });

  describe("Event listeners", () => {
    it("should include custom event listeners in disposables", () => {
      // one for the custom event listener, and any implemented in the base class as part of the
      // private `setEventListeners` method
      assert.ok(provider.disposables.length > 1);
      assert.ok(provider.setCustomEventListenersCalled);
    });

    it("should call the custom event listener callback when the event fires", () => {
      provider.testEventEmitter.fire();
      assert.ok(provider.testEventEmitterCalled);
    });
  });

  describe("reset()", () => {
    it("should clear the tree view", async () => {
      provider["treeView"].description = "this should go away";
      provider["treeView"].message = "this should go away too";

      await provider.reset();

      assert.strictEqual(provider["treeView"].description, undefined);
      assert.strictEqual(provider["treeView"].message, undefined);
    });

    it("should call .setSearch(null) to reset internal search state", async () => {
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
      const refreshSpy = sandbox.spy(provider, "refresh");

      await provider.reset();

      sinon.assert.calledOnce(refreshSpy);
    });
  });

  describe("setSearch()", () => {
    let setContextValueStub: sinon.SinonStub;

    beforeEach(() => {
      setContextValueStub = sandbox.stub(contextValues, "setContextValue").resolves();
    });

    it("should set internal search state when a value is passed", () => {
      provider.setSearch("First");

      assert.strictEqual(provider.itemSearchString, "First");
      assert.strictEqual(provider.searchMatches.size, 0);
      assert.strictEqual(provider.totalItemCount, 0);
    });

    it("should clear internal search state when no value is passed", () => {
      provider.itemSearchString = "running";
      provider.searchMatches.add(TEST_CCLOUD_FLINK_STATEMENT);
      provider.totalItemCount = 3;

      provider.setSearch(null);

      assert.strictEqual(provider.itemSearchString, null);
      assert.strictEqual(provider.searchMatches.size, 0, "searchMatches should be cleared");
      assert.strictEqual(provider.totalItemCount, 3, "totalItemCount should not change");
    });

    for (const arg of ["First", null]) {
      it(`should update the search context value (arg=${arg}) when .searchContextValue is set`, () => {
        // context value must be set for setContextValue to be called
        provider.searchContextValue = ContextValues.flinkStatementsSearchApplied;
        provider.setSearch(arg);

        sinon.assert.calledOnce(setContextValueStub);
        sinon.assert.calledWith(setContextValueStub, provider.searchContextValue, !!arg);
      });
    }

    for (const arg of ["First", null]) {
      it(`should not update the context value (arg=${arg}) when .searchContextValue is not set`, () => {
        provider.setSearch(arg);

        sinon.assert.notCalled(setContextValueStub);
      });
    }

    for (const arg of ["First", null]) {
      it(`should repaint the tree view when search is set (arg=${arg})`, async () => {
        const repaintSpy = sandbox.spy(provider["_onDidChangeTreeData"], "fire");

        provider.setSearch(arg);
        // Would normally be called by the tree view when children are requested
        // after setSearch() but we call it directly here to get totalItemCount assigned.
        provider.getChildren();

        assert.strictEqual(provider.itemSearchString, arg);
        assert.strictEqual(provider.searchMatches.size, 0);
        // totalItemCount is set to 2 because TestViewProvider.getChildren() always returns two items
        // and both are observed by the filterChildren() method.
        assert.strictEqual(provider.totalItemCount, 2);

        sinon.assert.calledOnce(repaintSpy);
      });
    }

    it("should filter children based on search string", () => {
      provider.setSearch("first");

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

    it("should update tree view message with search results when filterChildren() is called", () => {
      provider.setSearch("running");

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
        `Showing ${provider.searchMatches.size} of ${provider.totalItemCount} for "${provider.itemSearchString}"`,
      );
    });
  });

  describe("searchChangedEmitter", () => {
    let clock: sinon.SinonFakeTimers;
    const fakeEmitter = new EventEmitter<string | null>();

    beforeEach(() => {
      clock = sandbox.useFakeTimers();
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

  describe("withProgress", () => {
    it("should call window.withProgress", async () => {
      const withProgressStub = sandbox.stub(window, "withProgress").resolves();

      await provider.withProgress("Test Progress", async () => {
        // Simulate some work
        await new Promise((resolve) => setTimeout(resolve, 1));
      });

      sinon.assert.calledOnce(withProgressStub);
      sinon.assert.calledWith(withProgressStub, {
        location: { viewId: provider.viewId },
        title: "Test Progress",
        cancellable: false,
      });
    });
  });
});

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
    sandbox.restore();
    // reset singleton instances between tests
    BaseViewProvider["instanceMap"].clear();
  });

  describe("event listeners", () => {
    it("should register the default ccloudConnected event listener", () => {
      const handleSpy = sandbox.spy(provider, "handleCCloudConnectionChange");

      ccloudConnected.fire(true);

      assert.ok(handleSpy.calledOnce);
      assert.ok(handleSpy.calledWith(true));
    });

    it("handleCCloudConnectionChange() should call reset() when the `ccloudConnected` event fires and a CCloud resource is focused", () => {
      const resetSpy = sandbox.spy(provider, "reset");

      // simulate CCloud connection state change
      provider.resource = TEST_CCLOUD_FLINK_COMPUTE_POOL;
      provider["handleCCloudConnectionChange"](false);

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
      provider.handleCCloudConnectionChange(false);

      sinon.assert.notCalled(resetSpy);
      assert.strictEqual(provider.resource, fakeResource);
    });
  });

  describe("updateTreeViewDescription()", () => {
    it("should clear the description and clear .environment when no resource is focused", async () => {
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
      stubbedLoader.getEnvironment.resolves(TEST_CCLOUD_ENVIRONMENT);

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

    it("Should set the description to empty when environment is not found within loader", async () => {
      const stubbedLoader: sinon.SinonStubbedInstance<CCloudResourceLoader> =
        getStubbedCCloudResourceLoader(sandbox);
      stubbedLoader.getEnvironments.resolves([]);

      provider.resource = TEST_CCLOUD_FLINK_COMPUTE_POOL;
      provider.environment = TEST_CCLOUD_ENVIRONMENT;

      provider["treeView"].description = "this should go away";

      await provider.updateTreeViewDescription();

      assert.strictEqual(provider["treeView"].description, "");
      assert.strictEqual(provider.environment, null);
    });
  });

  describe("reset()", () => {
    it("should clear the tree view AND focused resources", async () => {
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
  });

  describe("setParentResource()", () => {
    let refreshStub: sinon.SinonStub;
    let setSearchStub: sinon.SinonStub;
    let setContextValueStub: sinon.SinonStub;
    let updateTreeViewDescriptionStub: sinon.SinonStub;

    beforeEach(() => {
      refreshStub = sandbox.stub(provider, "refresh").resolves();
      setSearchStub = sandbox.stub(provider, "setSearch");
      setContextValueStub = sandbox.stub(contextValues, "setContextValue").resolves();
      updateTreeViewDescriptionStub = sandbox
        .stub(provider, "updateTreeViewDescription")
        .resolves();
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
      const setParentResourceStub = sandbox.stub(provider, "setParentResource").resolves();
      provider.parentResourceChangedEmitter.fire(resource);
      sinon.assert.calledOnce(setParentResourceStub);
      sinon.assert.calledWith(setParentResourceStub, resource);
    });
  });

  for (const arg of ["First", null]) {
    it(`should repaint the tree view when search is set (arg=${arg})`, () => {
      const provider = TestViewProvider.getInstance();
      const repaintSpy = sandbox.spy(provider["_onDidChangeTreeData"], "fire");

      provider.setSearch(arg);
      // Would normally be called by the tree view when children are requested
      // after setSearch() but we call it directly here to get totalItemCount assigned.
      provider.getChildren();

      assert.strictEqual(provider.itemSearchString, arg);
      assert.strictEqual(provider.searchMatches.size, 0);
      // totalItemCount is set to 2 because TestViewProvider.getChildren() always returns two items
      assert.strictEqual(provider.totalItemCount, 2);

      sinon.assert.calledOnce(repaintSpy);
    });
  }

  it("should filter children based on search string", () => {
    const provider = TestViewProvider.getInstance();
    provider.setSearch("first");

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

  it("should update tree view message with search results when filterChildren() is called", () => {
    const provider = TestViewProvider.getInstance();
    provider.setSearch("running");

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
      `Showing ${provider.searchMatches.size} of ${provider.totalItemCount} for "${provider.itemSearchString}"`,
    );
  });
});

/** Test helper to make a SqlV1StatementStatus subcomponent of a FlinkStatement  */
function makeStatus(phase: Phase): SqlV1StatementStatus {
  return createFlinkStatement({ phase: phase }).status;
}
