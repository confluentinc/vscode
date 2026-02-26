import * as assert from "assert";
import * as sinon from "sinon";
import { MarkdownString, ThemeIcon, TreeItemCollapsibleState } from "vscode";
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

      it("should leave description undefined before any state transition", () => {
        const container = new TestContainer(testLabel, []);

        assert.strictEqual(container.description, undefined);
      });

      it("should start with isLoading=false and hasError=false", () => {
        const container = new TestContainer(testLabel, []);

        assert.strictEqual(container.isLoading, false);
        assert.strictEqual(container.hasError, false);
      });
    });

    describe("searchableText", () => {
      it("should return the label as searchable text", () => {
        const container = new TestContainer(testLabel, []);

        assert.strictEqual(container.searchableText(), testLabel);
      });
    });

    describe("setLoading()", () => {
      it("should set isLoading to true and hasError to false", () => {
        const container = new TestContainer(testLabel, []);

        container.setLoading();

        assert.strictEqual(container.isLoading, true);
        assert.strictEqual(container.hasError, false);
      });

      it("should use the loading icon", () => {
        const container = new TestContainer(testLabel, []);

        container.setLoading();

        assert.ok(container.iconPath);
        assert.strictEqual((container.iconPath as ThemeIcon).id, IconNames.LOADING);
      });

      it("should clear a previous error state", () => {
        const container = new TestContainer(testLabel, [], testContextValue);
        container.setError("some error");

        container.setLoading();

        assert.strictEqual(container.hasError, false);
        assert.strictEqual((container.iconPath as ThemeIcon).id, IconNames.LOADING);
      });
    });

    describe("setLoaded()", () => {
      it("should set children and update description", () => {
        const container = new TestContainer(testLabel, []);

        container.setLoaded(testResources);

        assert.deepStrictEqual(container.children, testResources);
        assert.strictEqual(container.description, `(${testResources.length})`);
      });

      it("should update description for empty children", () => {
        const container = new TestContainer(testLabel, []);

        container.setLoaded([]);

        assert.strictEqual(container.description, "(0)");
      });

      it("should clear isLoading and hasError", () => {
        const container = new TestContainer(testLabel, []);
        container.setLoading();

        container.setLoaded([testResource]);

        assert.strictEqual(container.isLoading, false);
        assert.strictEqual(container.hasError, false);
      });

      it("should restore the default icon", () => {
        const icon = new ThemeIcon("symbol-folder");
        const container = new TestContainer(testLabel, [], undefined, icon);
        container.setLoading();

        container.setLoaded([testResource]);

        assert.strictEqual(container.iconPath, icon);
      });

      it("should clear iconPath when no default icon is provided", () => {
        const container = new TestContainer(testLabel, []);
        container.setLoading();

        container.setLoaded([testResource]);

        assert.strictEqual(container.iconPath, undefined);
      });

      it("should clear tooltip", () => {
        const container = new TestContainer(testLabel, []);
        container.setError("some error");

        container.setLoaded([testResource]);

        assert.strictEqual(container.tooltip, undefined);
      });

      it("should restore contextValue to default (clearing -error suffix)", () => {
        const container = new TestContainer(testLabel, [], testContextValue);
        container.setError("some error");
        assert.strictEqual(container.contextValue, `${testContextValue}-error`);

        container.setLoaded([testResource]);

        assert.strictEqual(container.contextValue, testContextValue);
      });

      it("should not modify contextValue when none was provided", () => {
        const container = new TestContainer(testLabel, []);

        container.setLoaded([testResource]);

        assert.strictEqual(container.contextValue, undefined);
      });
    });

    describe("setError()", () => {
      it("should set hasError to true and clear isLoading", () => {
        const container = new TestContainer(testLabel, []);
        container.setLoading();

        container.setError("something went wrong");

        assert.strictEqual(container.hasError, true);
        assert.strictEqual(container.isLoading, false);
      });

      it("should clear children and set description to (0)", () => {
        const container = new TestContainer(testLabel, []);
        container.setLoaded(testResources);

        container.setError("something went wrong");

        assert.deepStrictEqual(container.children, []);
        assert.strictEqual(container.description, "(0)");
      });

      it("should use the error icon", () => {
        const container = new TestContainer(testLabel, []);

        container.setError("something went wrong");

        assert.deepStrictEqual(container.iconPath, ERROR_ICON);
      });

      it("should set the tooltip from a string", () => {
        const container = new TestContainer(testLabel, []);

        container.setError("something went wrong");

        assert.strictEqual(container.tooltip, "something went wrong");
      });

      it("should set the tooltip from a MarkdownString", () => {
        const container = new TestContainer(testLabel, []);
        const markdown = new MarkdownString("**Error**: something went wrong");

        container.setError(markdown);

        assert.strictEqual(container.tooltip, markdown);
      });

      it("should append -error suffix to contextValue", () => {
        const container = new TestContainer(testLabel, [], testContextValue);

        container.setError("something went wrong");

        assert.strictEqual(container.contextValue, `${testContextValue}-error`);
      });

      it("should not modify contextValue when none was provided", () => {
        const container = new TestContainer(testLabel, []);

        container.setError("something went wrong");

        assert.strictEqual(container.contextValue, undefined);
      });
    });

    describe("state transitions", () => {
      it("loading -> loaded: should settle all state correctly", () => {
        const container = new TestContainer(testLabel, [], testContextValue);
        container.setLoading();

        container.setLoaded([testResource]);

        assert.strictEqual(container.isLoading, false);
        assert.strictEqual(container.hasError, false);
        assert.strictEqual(container.description, "(1)");
        assert.strictEqual(container.iconPath, undefined);
        assert.strictEqual(container.tooltip, undefined);
        assert.strictEqual(container.contextValue, testContextValue);
      });

      it("loading -> error: should settle all state correctly", () => {
        const container = new TestContainer(testLabel, [], testContextValue);
        container.setLoading();

        container.setError("failure");

        assert.strictEqual(container.isLoading, false);
        assert.strictEqual(container.hasError, true);
        assert.deepStrictEqual(container.children, []);
        assert.strictEqual(container.description, "(0)");
        assert.deepStrictEqual(container.iconPath, ERROR_ICON);
        assert.strictEqual(container.tooltip, "failure");
        assert.strictEqual(container.contextValue, `${testContextValue}-error`);
      });

      it("error -> loading -> loaded: full recovery cycle", () => {
        const container = new TestContainer(testLabel, [], testContextValue);

        container.setError("initial failure");
        assert.strictEqual(container.hasError, true);

        container.setLoading();
        assert.strictEqual(container.isLoading, true);
        assert.strictEqual(container.hasError, false);

        container.setLoaded([testResource]);
        assert.strictEqual(container.isLoading, false);
        assert.strictEqual(container.hasError, false);
        assert.strictEqual(container.contextValue, testContextValue);
        assert.deepStrictEqual(container.children, [testResource]);
      });

      it("loaded -> loading -> error -> loading -> loaded: repeated transitions", () => {
        const icon = new ThemeIcon("symbol-folder");
        const container = new TestContainer(testLabel, [], testContextValue, icon);

        container.setLoaded(testResources);
        assert.strictEqual(container.iconPath, icon);

        container.setLoading();
        assert.strictEqual((container.iconPath as ThemeIcon).id, IconNames.LOADING);

        container.setError("transient failure");
        assert.deepStrictEqual(container.iconPath, ERROR_ICON);
        assert.strictEqual(container.contextValue, `${testContextValue}-error`);

        container.setLoading();
        assert.strictEqual((container.iconPath as ThemeIcon).id, IconNames.LOADING);

        container.setLoaded([testResource]);
        assert.strictEqual(container.iconPath, icon);
        assert.strictEqual(container.contextValue, testContextValue);
        assert.strictEqual(container.tooltip, undefined);
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
        await container.ensureDoneLoading();

        assert.strictEqual(container.isLoading, false);
      });

      it("should wait for loading to complete", async () => {
        container.setLoading();

        const waitPromise = container.ensureDoneLoading();

        await clock.tickAsync(200);
        container.setLoaded([]);
        await clock.tickAsync(LOADING_POLL_INTERVAL_MS + 1);

        await waitPromise;
        assert.strictEqual(container.isLoading, false);
      });

      it("should timeout if loading never completes", async () => {
        container.setLoading();

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
        container.setLoaded(resources);

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
