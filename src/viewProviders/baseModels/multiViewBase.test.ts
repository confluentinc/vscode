import * as assert from "assert";
import * as sinon from "sinon";
import type { CancellationToken, Progress } from "vscode";
import { EventEmitter, TreeItem, window } from "vscode";
import { ConnectionType } from "../../clients/sidecar";
import { CCLOUD_CONNECTION_ID } from "../../constants";
import * as contextValues from "../../context/values";
import type { ContextValues } from "../../context/values";
import type { ConnectionId, EnvironmentId } from "../../models/resource";
import * as collapsingUtils from "../utils/collapsing";
import { SEARCH_DECORATION_URI_SCHEME } from "../utils/search";
import { MultiModeViewProvider, ViewProviderDelegate } from "./multiViewBase";

const TEST_CONTEXT_VALUE: ContextValues = "test-value" as ContextValues;

enum TestMode {
  Foo = "foo",
  Bar = "bar",
}

class TestParentResource {
  connectionId: ConnectionId = CCLOUD_CONNECTION_ID;
  connectionType: ConnectionType = ConnectionType.Ccloud;
  environmentId: EnvironmentId = "test-env-id" as EnvironmentId;
  id: string = "test-parent";

  searchableText(): string {
    return `Test Parent ${this.id}`;
  }
}

class TestDelegateChild {
  connectionId: ConnectionId = CCLOUD_CONNECTION_ID;
  connectionType: ConnectionType = ConnectionType.Ccloud;

  constructor(
    public id: string,
    public name: string,
  ) {}

  searchableText(): string {
    return `${this.name} ${this.id}`;
  }
}

class FooDelegate extends ViewProviderDelegate<TestMode, TestParentResource, TestDelegateChild> {
  readonly mode: TestMode = TestMode.Foo;
  readonly viewTitle = "Mode Foo";
  loadingMessage = "Loading Foo items...";

  children: TestDelegateChild[] = [];

  async fetchChildren(): Promise<TestDelegateChild[]> {
    return this.children;
  }

  getTreeItem(element: TestDelegateChild): TreeItem {
    return new TreeItem(element.name);
  }
}

class BarDelegate extends ViewProviderDelegate<TestMode, TestParentResource, TestDelegateChild> {
  readonly mode: TestMode = TestMode.Bar;
  readonly viewTitle = "Mode Bar";
  loadingMessage = "Loading Bar items...";

  children: TestDelegateChild[] = [];

  async fetchChildren(): Promise<TestDelegateChild[]> {
    return this.children;
  }

  getTreeItem(element: TestDelegateChild): TreeItem {
    return new TreeItem(element.name);
  }
}

class TestMultiViewProvider extends MultiModeViewProvider<
  TestMode,
  TestParentResource,
  TestDelegateChild
> {
  readonly viewId = "test-multiview";
  readonly loggerName = "test.multiview";
  readonly kind = "test";

  parentResourceChangedEmitter = new EventEmitter<TestParentResource | null>();
  parentResourceChangedContextValue = TEST_CONTEXT_VALUE;

  constructor() {
    super();
    const fooDelegate = new FooDelegate();
    const barDelegate = new BarDelegate();

    this.treeViewDelegates = new Map<
      TestMode,
      ViewProviderDelegate<TestMode, TestParentResource, TestDelegateChild>
    >([
      [TestMode.Foo, fooDelegate],
      [TestMode.Bar, barDelegate],
    ]);

    this.defaultDelegate = fooDelegate;
    this.currentDelegate = this.defaultDelegate;
    this.delegateContextValue = TEST_CONTEXT_VALUE;
  }
}

describe("viewProviders/baseModels/multiViewBase.ts", () => {
  let sandbox: sinon.SinonSandbox;
  let provider: TestMultiViewProvider;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("MultiModeViewProvider", () => {
    beforeEach(() => {
      // stub createTreeView to avoid actually creating a VS Code tree view
      sandbox.stub(window, "createTreeView").callsFake((): any => {
        return {
          title: undefined as string | undefined,
          message: undefined as string | undefined,
          description: undefined as string | undefined,
          dispose: () => {},
        } as any;
      });

      sandbox.stub(window, "withProgress").callsFake((_, cb) => {
        const p = {} as Progress<unknown>;
        const t = {} as CancellationToken;
        return Promise.resolve(cb(p, t));
      });

      provider = TestMultiViewProvider["getInstance"]();
    });

    afterEach(() => {
      provider.dispose();
      TestMultiViewProvider["instanceMap"].clear();
    });

    it("starts with default delegate and delegates children", () => {
      // no resource -> no children
      const childrenNone = provider.getChildren();
      assert.deepStrictEqual(childrenNone, []);

      // with resource -> returns delegate children
      const fakeChildItem = new TestDelegateChild("id1", "Test Item 1");
      provider["resource"] = new TestParentResource();
      const delegate = provider["currentDelegate"];
      delegate.children = [fakeChildItem];
      const children = provider.getChildren();

      assert.strictEqual(children.length, 1);
      assert.strictEqual(children[0].name, fakeChildItem.name);
    });

    describe("switchMode()", () => {
      let refreshStub: sinon.SinonStub;
      let setContextStub: sinon.SinonStub;
      let searchMatchesClearSpy: sinon.SinonSpy;

      beforeEach(() => {
        refreshStub = sandbox.stub(provider, "refresh").resolves();
        setContextStub = sandbox.stub(contextValues, "setContextValue").resolves();
        searchMatchesClearSpy = sandbox.spy(provider["searchMatches"], "clear");
      });

      it("should update delegate, title, context, and then call refresh()", async () => {
        await provider.switchMode(TestMode.Bar);

        const delegate = provider["currentDelegate"];
        assert.strictEqual(delegate.mode, TestMode.Bar);
        assert.strictEqual(provider["treeView"].title, "Mode Bar");
        sinon.assert.calledWith(setContextStub, TEST_CONTEXT_VALUE, TestMode.Bar);
        sinon.assert.calledOnce(refreshStub);
        sinon.assert.calledOnce(searchMatchesClearSpy);
      });

      it("should just call refresh() when passed the same mode", async () => {
        await provider.switchMode(TestMode.Foo);

        sinon.assert.calledOnce(refreshStub);
        sinon.assert.notCalled(setContextStub);
        sinon.assert.notCalled(searchMatchesClearSpy);
      });

      it("should not change the delegate when an unknown mode is passed", async () => {
        const delegate = provider["currentDelegate"];

        await provider.switchMode("ASDF" as TestMode);

        assert.strictEqual(provider["currentDelegate"], delegate);
        sinon.assert.notCalled(refreshStub);
        sinon.assert.notCalled(setContextStub);
        sinon.assert.notCalled(searchMatchesClearSpy);
      });
    });

    describe("getTreeItem()", () => {
      const fakeChildItem = new TestDelegateChild("id1", "Test Item 1");
      let updateCollapsibleStateFromSearchStub: sinon.SinonStub;

      beforeEach(() => {
        updateCollapsibleStateFromSearchStub = sandbox
          .stub(collapsingUtils, "updateCollapsibleStateFromSearch")
          .callThrough();
      });

      it("delegates to the current mode's getTreeItem()", () => {
        provider["resource"] = new TestParentResource();
        const delegate = provider["currentDelegate"];
        delegate.children = [fakeChildItem];
        const item = provider.getTreeItem(delegate.children[0]);

        assert.strictEqual(item.label, fakeChildItem.name);
        // should not smell search resulty by default
        assert.strictEqual(item.resourceUri, undefined);
        sinon.assert.notCalled(updateCollapsibleStateFromSearchStub);
      });

      it("decorates the item when it matches the search string", () => {
        provider["resource"] = new TestParentResource();
        const delegate = provider["currentDelegate"];
        delegate.children = [fakeChildItem];
        provider["itemSearchString"] = "Item 1";
        const item = provider.getTreeItem(delegate.children[0]);

        assert.strictEqual(item.label, fakeChildItem.name);
        // should have the special URI scheme to indicate a search match
        assert.ok(item.resourceUri);
        assert.strictEqual(item.resourceUri!.scheme, SEARCH_DECORATION_URI_SCHEME);
        sinon.assert.calledOnce(updateCollapsibleStateFromSearchStub);
      });
    });
  });

  describe("reset()", () => {
    it("reverts to the default delegate and updates context", async () => {
      const setContextStub = sandbox.stub(contextValues, "setContextValue").resolves();
      provider["currentDelegate"] = provider["treeViewDelegates"].get(TestMode.Bar)!;

      await provider.reset();

      const delegate = provider["currentDelegate"];
      assert.strictEqual(delegate.mode, TestMode.Foo);
      sinon.assert.calledWith(setContextStub, TEST_CONTEXT_VALUE, TestMode.Foo);
    });
  });
});
