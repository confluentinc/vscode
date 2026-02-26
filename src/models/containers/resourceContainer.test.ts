import * as assert from "assert";
import * as sinon from "sinon";
import { ThemeIcon, TreeItemCollapsibleState } from "vscode";
import { createTestResource } from "../../../tests/unit/testResources/base";
import { ConnectionType } from "../../clients/sidecar";
import { CCLOUD_CONNECTION_ID } from "../../constants";
import { ERROR_ICON, IconNames } from "../../icons";
import type { BaseViewProviderData } from "../../viewProviders/baseModels/base";
import { LOADING_POLL_INTERVAL_MS, ResourceContainer } from "./resourceContainer";

/** Minimal concrete subclass to test abstract base. */
class TestContainer extends ResourceContainer<BaseViewProviderData> {
  readonly loggerName = "test.TestContainer";

  constructor(
    label: string,
    children: BaseViewProviderData[],
    contextValue?: string,
    icon?: ThemeIcon,
  ) {
    super(CCLOUD_CONNECTION_ID, ConnectionType.Ccloud, label, children, contextValue, icon);
    this.id = `test-${label}`;
  }
}

describe("models/containers/resourceContainer.ts", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("ResourceContainer", () => {
    const testLabel = "Test Resource Group";
    const testContextValue = "test.context";
    const testResource = createTestResource("test-resource");
    const testResources = [
      createTestResource("test-resource-1"),
      createTestResource("test-resource-2"),
    ];

    describe("constructor", () => {
      it("should set label and id from arguments", () => {
        const container = new TestContainer(testLabel, testResources);

        assert.strictEqual(container.label, testLabel);
        assert.strictEqual(container.id, `test-${testLabel}`);
      });

      it("should always set the collapsible state to Collapsed", () => {
        const withChildren = new TestContainer(testLabel, testResources);
        assert.strictEqual(withChildren.collapsibleState, TreeItemCollapsibleState.Collapsed);

        const withoutChildren = new TestContainer(testLabel, []);
        assert.strictEqual(withoutChildren.collapsibleState, TreeItemCollapsibleState.Collapsed);
      });

      it("should set iconPath from the icon argument", () => {
        const icon = new ThemeIcon("symbol-folder");
        const container = new TestContainer(testLabel, [], undefined, icon);

        assert.strictEqual(container.iconPath, icon);
      });

      it("should leave iconPath undefined when no icon is provided", () => {
        const container = new TestContainer(testLabel, []);

        assert.strictEqual(container.iconPath, undefined);
      });

      it("should set contextValue when provided", () => {
        const container = new TestContainer(testLabel, [], testContextValue);

        assert.strictEqual(container.contextValue, testContextValue);
      });

      it("should leave contextValue undefined when omitted", () => {
        const container = new TestContainer(testLabel, []);

        assert.strictEqual(container.contextValue, undefined);
      });

      it("should leave description undefined before children setter is called", () => {
        const container = new TestContainer(testLabel, []);

        assert.strictEqual(container.description, undefined);
      });
    });

    describe("children setter", () => {
      it("should update description when `children` is set", () => {
        const container = new TestContainer(testLabel, []);
        // description is not set in constructor (before loading)
        assert.strictEqual(container.description, undefined);

        // but is set when children is set
        container.children = testResources;
        assert.strictEqual(container.description, `(${testResources.length})`);

        // and updates when children change
        container.children = [];
        assert.strictEqual(container.description, "(0)");
      });

      it("should clear isLoading state when children are set", () => {
        const container = new TestContainer(testLabel, []);
        container.isLoading = true;

        container.children = [testResource];

        assert.strictEqual(container.isLoading, false);
      });

      it("should clear hasError when non-empty children are set", () => {
        const container = new TestContainer(testLabel, []);
        container.hasError = true;

        container.children = [testResource];

        assert.strictEqual(container.hasError, false);
      });

      it("should preserve hasError when empty children are set", () => {
        const container = new TestContainer(testLabel, []);
        container.hasError = true;

        container.children = [];

        assert.strictEqual(container.hasError, true);
      });
    });

    describe("searchableText", () => {
      it("should return the label as searchable text", () => {
        const container = new TestContainer(testLabel, []);

        assert.strictEqual(container.searchableText(), testLabel);
      });
    });

    describe("isLoading", () => {
      it("should start with isLoading set to false", () => {
        const container = new TestContainer(testLabel, []);

        assert.strictEqual(container.isLoading, false);
      });

      it("should use the loading icon when isLoading is set to true", () => {
        const container = new TestContainer(testLabel, []);

        container.isLoading = true;

        assert.ok(container.iconPath);
        assert.strictEqual((container.iconPath as ThemeIcon).id, IconNames.LOADING);
      });

      it("should use the default icon when isLoading is set to false", () => {
        const icon = new ThemeIcon("symbol-folder");
        const container = new TestContainer(testLabel, [], undefined, icon);

        container.isLoading = true;
        assert.strictEqual((container.iconPath as ThemeIcon).id, IconNames.LOADING);

        container.isLoading = false;
        assert.strictEqual(container.iconPath, icon);
      });

      it("should clear .iconPath when isLoading is set to false and no default icon is provided", () => {
        const container = new TestContainer(
          "A",
          [],
          // no default icon (nor contextValue) set
        );

        // set initial loading state
        container.isLoading = true;
        assert.ok(container.iconPath);
        assert.strictEqual((container.iconPath as ThemeIcon).id, IconNames.LOADING);

        container.isLoading = false;
        assert.strictEqual(container.iconPath, undefined);
      });
    });

    describe("hasError", () => {
      it("should start with hasError set to false", () => {
        const container = new TestContainer(testLabel, []);
        assert.strictEqual(container.hasError, false);
      });

      it("should use the error icon when hasError is set to true", () => {
        const container = new TestContainer(testLabel, []);

        container.hasError = true;

        assert.deepStrictEqual(container.iconPath, ERROR_ICON);
      });

      it("should use the default icon when hasError is set to false", () => {
        const icon = new ThemeIcon("symbol-folder");
        const container = new TestContainer(testLabel, [], undefined, icon);

        container.hasError = true;
        assert.deepStrictEqual(container.iconPath, ERROR_ICON);

        container.hasError = false;
        assert.strictEqual(container.iconPath, icon);
      });

      it("should clear .iconPath when hasError is set to false and no default icon is provided", () => {
        const container = new TestContainer(testLabel, []);

        container.hasError = true;
        assert.deepStrictEqual(container.iconPath, ERROR_ICON);

        container.hasError = false;
        assert.strictEqual(container.iconPath, undefined);
      });

      it("should toggle the contextValue between error and non-error states without suffix duplication", () => {
        const container = new TestContainer(testLabel, [], testContextValue);

        container.hasError = true;
        assert.strictEqual(container.contextValue, `${testContextValue}-error`);

        container.hasError = false;
        assert.strictEqual(container.contextValue, testContextValue);

        // verify no suffix duplication on repeated toggles
        container.hasError = true;
        assert.strictEqual(container.contextValue, `${testContextValue}-error`);
      });

      it("should not modify .contextValue when no original contextValue was provided in the constructor", () => {
        const container = new TestContainer(testLabel, []);

        container.hasError = true;
        assert.strictEqual(container.contextValue, undefined);

        container.hasError = false;
        assert.strictEqual(container.contextValue, undefined);
      });
    });

    describe("state interactions", () => {
      it("should settle loading state and description when setting children", () => {
        const container = new TestContainer(testLabel, []);
        container.isLoading = true;

        container.children = [testResource];

        assert.strictEqual(container.isLoading, false);
        assert.strictEqual(container.description, "(1)");
        assert.strictEqual(container.iconPath, undefined);
      });

      it("should clear hasError when setting non-empty children", () => {
        const container = new TestContainer(testLabel, [], testContextValue);
        container.hasError = true;

        container.children = [testResource];

        assert.strictEqual(container.hasError, false);
        assert.strictEqual(container.description, "(1)");
        assert.strictEqual(container.iconPath, undefined);
        assert.strictEqual(container.contextValue, testContextValue);
      });

      it("should not clear hasError when setting empty children array", () => {
        const container = new TestContainer(testLabel, [], testContextValue);
        container.hasError = true;

        container.children = [];

        assert.strictEqual(container.hasError, true);
        assert.strictEqual(container.description, "(0)");
        assert.strictEqual(container.contextValue, `${testContextValue}-error`);
      });

      it("should handle multiple state transitions", () => {
        const container = new TestContainer(testLabel, [], testContextValue);

        container.isLoading = true;
        assert.ok(container.iconPath);

        container.hasError = true;
        assert.strictEqual(container.contextValue, `${testContextValue}-error`);
        assert.ok(container.iconPath);

        container.children = [testResource];
        assert.strictEqual(container.isLoading, false);
        assert.strictEqual(container.hasError, false);
        assert.strictEqual(container.contextValue, testContextValue);
        assert.strictEqual(container.iconPath, undefined);
      });

      it("should handle error recovery with empty then non-empty children", () => {
        const container = new TestContainer(testLabel, [], testContextValue);

        container.hasError = true;
        container.children = [];
        assert.strictEqual(container.hasError, true);
        assert.strictEqual(container.contextValue, `${testContextValue}-error`);

        container.children = [testResource];
        assert.strictEqual(container.hasError, false);
        assert.strictEqual(container.contextValue, testContextValue);
      });
    });

    describe("ensureDoneLoading", () => {
      let clock: sinon.SinonFakeTimers;
      let container: TestContainer;

      beforeEach(() => {
        clock = sandbox.useFakeTimers();
        container = new TestContainer(testLabel, []);
      });

      it("should resolve immediately when not loading", async () => {
        container.isLoading = false;

        await container.ensureDoneLoading();

        assert.strictEqual(container.isLoading, false);
      });

      it("should wait for loading to complete", async () => {
        container.isLoading = true;

        const waitPromise = container.ensureDoneLoading();

        await clock.tickAsync(200);
        container.isLoading = false;
        await clock.tickAsync(LOADING_POLL_INTERVAL_MS + 1);

        await waitPromise;
        assert.strictEqual(container.isLoading, false);
      });

      it("should timeout if loading never completes", async () => {
        container.isLoading = true;

        const timeoutMs = 500;
        const waitPromise = container.ensureDoneLoading(timeoutMs);
        await clock.tickAsync(timeoutMs + 10);

        await assert.rejects(waitPromise, /Timeout waiting for container to finish loading/);
      });
    });

    describe("gatherResources", () => {
      let ensureDoneLoadingStub: sinon.SinonStub;
      let container: TestContainer;

      beforeEach(() => {
        container = new TestContainer(testLabel, []);
        ensureDoneLoadingStub = sandbox.stub(container, "ensureDoneLoading");
      });

      it("should return children after calling ensureDoneLoading", async () => {
        const resources = [testResource];
        container.children = resources;

        const result = await container.gatherResources();

        assert.deepStrictEqual(result, resources);
        sinon.assert.calledOnce(ensureDoneLoadingStub);
      });

      it("should return an empty array if ensureDoneLoading times out", async () => {
        ensureDoneLoadingStub.rejects(new Error("Timeout waiting for container to finish loading"));

        const result = await container.gatherResources();

        assert.deepStrictEqual(result, []);
        sinon.assert.calledOnce(ensureDoneLoadingStub);
      });
    });
  });
});
