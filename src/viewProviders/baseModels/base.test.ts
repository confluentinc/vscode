import * as assert from "assert";
import * as sinon from "sinon";
import type { Disposable } from "vscode";
import { EventEmitter, TreeItem, Uri, window } from "vscode";
import { getTestExtensionContext } from "../../../tests/unit/testUtils";
import { ConnectionType } from "../../clients/sidecar";
import { CCLOUD_CONNECTION_ID } from "../../constants";
import * as contextValues from "../../context/values";
import { ContextValues } from "../../context/values";
import { SEARCH_DECORATION_URI_SCHEME } from "../utils/search";
import type { BaseViewProviderData } from "./base";
import { BaseViewProvider } from "./base";

/** Helper function to create a test object that satisfies {@link BaseViewProviderData}. */
function createTestResource(
  id: string,
  name: string,
  children?: BaseViewProviderData[],
): BaseViewProviderData {
  return {
    id,
    connectionId: CCLOUD_CONNECTION_ID,
    connectionType: ConnectionType.Ccloud,
    searchableText: () => name,
    children,
  };
}

/** Sample view provider subclass for testing {@link BaseViewProvider}. */
class TestViewProvider extends BaseViewProvider<BaseViewProviderData> {
  loggerName = "viewProviders.test.TestViewProvider";
  viewId = "confluent-test-parentless-statements";

  readonly kind = "test-parentless-statements";

  getChildren(element?: BaseViewProviderData): BaseViewProviderData[] {
    // Always return two items.
    const items = [
      createTestResource("item-1", "first-item"),
      createTestResource("item-2", "second-item"),
    ];

    return this.filterChildren(element, items);
  }

  getTreeItem(element: BaseViewProviderData): TreeItem {
    const treeItem = new TreeItem(element.searchableText());
    treeItem.id = element.id;
    return treeItem;
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
      provider.searchMatches.add(createTestResource("test-1", "test-item"));
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
          // searchMatches.size depends on whether the search string matches any items
          // "First" matches the resource with the "first-*" name; null matches nothing
          const expectedMatches = arg === "First" ? 1 : 0;
          assert.strictEqual(provider.searchMatches.size, expectedMatches);
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

        const matchingItem = createTestResource("item-1", "first-statement");
        const items = [matchingItem, createTestResource("item-2", "second-statement")];

        provider.totalItemCount = 17; // should be overwritten

        const filtered = provider.filterChildren(undefined, items);

        assert.strictEqual(filtered.length, 1);
        assert.strictEqual(filtered[0].id, matchingItem.id);
        assert.strictEqual(provider.searchMatches.size, 1);
        assert.strictEqual(provider.totalItemCount, 2);
      });

      it("should maintain totalItemCount, searchMatches, and the treeview message properly", () => {
        provider.setSearch("first");

        // set up as if from a previous state, now provider.searchMatches.size == 1
        provider.searchMatches.add(createTestResource("prev-item", "previous-item"));
        // Before these next two children are filtered, totalItemCount is 17
        provider.totalItemCount = 17;

        const items = [
          createTestResource("item-1", "first-statement"),
          createTestResource("item-2", "second-statement"),
        ];

        // simulate a previous call with a parent element that populated searchMatches
        provider.filterChildren(items[0], items);
        // One more child match makes for two total matches
        assert.strictEqual(provider.searchMatches.size, 2);
        assert.strictEqual(
          provider["treeView"].message,
          `Showing 2 of 19 for "${provider.itemSearchString}"`,
        );

        // now call with no parent element, which should clear searchMatches, totalItemCount,
        // and recount totalItemCount based on the children passed in (2)
        provider.filterChildren(undefined, items);
        assert.strictEqual(provider.searchMatches.size, 1); // only one of the two items matches
        assert.strictEqual(provider.totalItemCount, 2);
        assert.strictEqual(
          provider["treeView"].message,
          `Showing 1 of 2 for "${provider.itemSearchString}"`,
        );
      });
    });

    it("should increment totalItemCount when filterChildren() is called with a parent element", () => {
      provider.setSearch("anything");

      const items = [
        createTestResource("item-1", "first-statement"),
        createTestResource("item-2", "second-statement"),
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

  describe("adjustTreeItemForSearch()", () => {
    it("should set a TreeItem's resourceUri when matching the provider's  search string", () => {
      const testItem = createTestResource("matching-id", "matching-statement");
      const testTreeItem = new TreeItem(testItem.searchableText());
      testTreeItem.id = testItem.id;
      provider.itemSearchString = "matching";

      provider.adjustTreeItemForSearch(testItem, testTreeItem);

      assert.ok(testTreeItem.resourceUri);
      assert.strictEqual(testTreeItem.resourceUri?.scheme, SEARCH_DECORATION_URI_SCHEME);
      assert.ok(testTreeItem.resourceUri?.path.includes(testItem.id));
    });

    it("should clear a TreeItem's resourceUri when it doesn't match the provider's search string", () => {
      const testItem = createTestResource("non-matching-id", "non-matching-statement");
      const testTreeItem = new TreeItem(testItem.searchableText());
      testTreeItem.id = testItem.id;
      // simulate a previous search that set .resourceUri
      testTreeItem.resourceUri = Uri.parse(`${SEARCH_DECORATION_URI_SCHEME}:/previous-id`);
      provider.itemSearchString = "different-search";

      provider.adjustTreeItemForSearch(testItem, testTreeItem);

      assert.strictEqual(testTreeItem.resourceUri, undefined);
    });

    it("should clear a TreeItem's resourceUri when no search string is set", () => {
      const testItem = createTestResource("any-id", "any-statement");
      const treeItem = new TreeItem(testItem.searchableText());
      treeItem.id = testItem.id;
      // simulate a previous search that set .resourceUri
      treeItem.resourceUri = Uri.parse(`${SEARCH_DECORATION_URI_SCHEME}:/previous-id`);
      provider.itemSearchString = null;

      provider.adjustTreeItemForSearch(testItem, treeItem);

      assert.strictEqual(treeItem.resourceUri, undefined);
    });

    it("should handle persistent TreeItem objects correctly when search is cleared", () => {
      const testItem = createTestResource("persistent-id", "persistent-statement");
      const persistentTreeItem = new TreeItem(testItem.searchableText());
      persistentTreeItem.id = testItem.id;

      // item matches initial search string
      provider.itemSearchString = "persistent";
      provider.adjustTreeItemForSearch(testItem, persistentTreeItem);
      assert.ok(persistentTreeItem.resourceUri);
      assert.strictEqual(persistentTreeItem.resourceUri?.scheme, SEARCH_DECORATION_URI_SCHEME);

      // search is cleared, so resourceUri should also be cleared
      // (until https://github.com/confluentinc/vscode/issues/1777 changes this behavior)
      provider.itemSearchString = null;
      provider.adjustTreeItemForSearch(testItem, persistentTreeItem);
      assert.strictEqual(persistentTreeItem.resourceUri, undefined);

      // match again to so we know resourceUri is set before switching search strings
      provider.itemSearchString = "persistent";
      provider.adjustTreeItemForSearch(testItem, persistentTreeItem);
      assert.ok(persistentTreeItem.resourceUri);

      // different search where item doesn't match
      provider.itemSearchString = "different";
      provider.adjustTreeItemForSearch(testItem, persistentTreeItem);
      assert.strictEqual(persistentTreeItem.resourceUri, undefined);
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
