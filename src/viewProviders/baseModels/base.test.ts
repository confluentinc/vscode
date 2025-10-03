import * as assert from "assert";
import * as sinon from "sinon";
import { Disposable, EventEmitter, TreeItem, window } from "vscode";
import {
  makeStatus,
  TEST_CCLOUD_FLINK_STATEMENT,
} from "../../../tests/unit/testResources/flinkStatement";
import { getTestExtensionContext } from "../../../tests/unit/testUtils";
import * as contextValues from "../../context/values";
import { ContextValues } from "../../context/values";
import { FlinkStatement, FlinkStatementTreeItem, Phase } from "../../models/flinkStatement";
import { BaseViewProvider } from "./base";

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
    provider.dispose();
    // reset singleton instances between tests
    BaseViewProvider["instanceMap"].clear();
    sandbox.restore();
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
      assert.ok(provider["disposables"].length > 1);
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

  describe("setSearch() and filterChildren()", () => {
    let setContextValueStub: sinon.SinonStub;

    beforeEach(() => {
      setContextValueStub = sandbox.stub(contextValues, "setContextValue");
    });

    describe("setSearch()", () => {
      it("should set internal search state when a value is passed", () => {
        provider.setSearch("First");

        assert.strictEqual(provider.itemSearchString, "First");
        assert.strictEqual(provider.searchMatches.size, 0);
        assert.strictEqual(provider.totalItemCount, 0);
        assert.strictEqual(provider.searchStringSetCount, 1);

        // Should increment searchStringSetCount
        provider.setSearch("Second");
        assert.strictEqual(provider.searchStringSetCount, 2);
      });

      it("should clear internal search state when no value is passed", () => {
        provider.itemSearchString = "running";
        provider.searchMatches.add(TEST_CCLOUD_FLINK_STATEMENT);
        provider.totalItemCount = 3;
        provider.searchStringSetCount = 2;

        provider.setSearch(null);

        assert.strictEqual(provider.itemSearchString, null);
        assert.strictEqual(provider.searchMatches.size, 0, "searchMatches should be cleared");
        assert.strictEqual(provider.totalItemCount, 0, "totalItemCount should be reset");
        assert.strictEqual(
          provider.searchStringSetCount,
          2,
          "searchStringSetCount should not change when clearing search",
        );
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
    });

    describe("filterChildren()", () => {
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

        provider.totalItemCount = 17; // should be overwritten

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

    it("should increment totalItemCount when filterChildren() is called with a parent element", () => {
      provider.setSearch("anything");

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

      // set up as if from a previous state
      provider.totalItemCount = 17;

      // with no parent element, totalItemCount should be reset to zero and then updated to the
      // number of items passed in (2)
      let filtered = provider.filterChildren(undefined, items);
      assert.strictEqual(provider.totalItemCount, 2);
      // the search string doesn't match either item, so filtered should be empty
      assert.strictEqual(filtered.length, 0);

      // with a parent element, totalItemCount should be incremented by the number of items passed in
      // (This call is simulating as if items[] were children of parent element items[0])
      filtered = provider.filterChildren(items[0], items);
      assert.strictEqual(provider.totalItemCount, 4);
      // the search string still doesn't match either item, so filtered should be empty
      assert.strictEqual(filtered.length, 0);
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
