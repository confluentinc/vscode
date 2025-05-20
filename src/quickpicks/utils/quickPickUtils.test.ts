import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { createEnhancedQuickPick, EnhancedQuickPickOptions } from "./quickPickUtils";

describe("createEnhancedQuickPick", () => {
  let sandbox: sinon.SinonSandbox;
  let createQuickPickStub: sinon.SinonStub;
  let quickPickMock: vscode.QuickPick<any>;
  let hideStub: sinon.SinonStub;
  let onDidChangeSelectionStub: sinon.SinonStub;
  let onDidChangeActiveStub: sinon.SinonStub;
  let onDidTriggerItemButtonStub: sinon.SinonStub;
  let onDidTriggerButtonStub: sinon.SinonStub;
  let onDidAcceptStub: sinon.SinonStub;
  let onDidHideStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    hideStub = sandbox.stub();

    // Create explicit stubs for each event handler
    onDidChangeSelectionStub = sandbox.stub().returns({ dispose: () => {} });
    onDidChangeActiveStub = sandbox.stub().returns({ dispose: () => {} });
    onDidTriggerItemButtonStub = sandbox.stub().returns({ dispose: () => {} });
    onDidTriggerButtonStub = sandbox.stub().returns({ dispose: () => {} });
    onDidAcceptStub = sandbox.stub().returns({ dispose: () => {} });
    onDidHideStub = sandbox.stub().returns({ dispose: () => {} });

    // Create a mock QuickPick with all required properties and methods
    quickPickMock = {
      placeholder: "",
      ignoreFocusOut: false,
      title: undefined,
      canSelectMany: false,
      matchOnDescription: false,
      matchOnDetail: false,
      buttons: [],
      items: [],
      selectedItems: [],
      busy: false,
      show: sandbox.stub(),
      hide: hideStub,
      dispose: sandbox.stub(),
      onDidChangeSelection: onDidChangeSelectionStub,
      onDidChangeActive: onDidChangeActiveStub,
      onDidTriggerItemButton: onDidTriggerItemButtonStub,
      onDidTriggerButton: onDidTriggerButtonStub,
      onDidAccept: onDidAcceptStub,
      onDidHide: onDidHideStub,
      value: "",
      onDidChangeValue: sandbox.stub(),
      activeItems: [],
      step: undefined,
      totalSteps: undefined,
      enabled: true,
      description: undefined,
      detail: undefined,
      keepScrollPosition: false,
    } as vscode.QuickPick<any>;

    // Stub the createQuickPick method to return our mock
    createQuickPickStub = sandbox.stub(vscode.window, "createQuickPick").returns(quickPickMock);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("Basic configuration", () => {
    it("should create a QuickPick with default options", async () => {
      const items = [{ label: "Item 1" }];
      const quickPickPromise = createEnhancedQuickPick(items);

      // Verify the QuickPick was created
      sinon.assert.calledOnce(createQuickPickStub);

      // Trigger hide to resolve the promise
      const hideHandler = onDidHideStub.args[0][0];
      hideHandler();

      const { quickPick, selectedItems } = await quickPickPromise;

      // Verify default options and items
      assert.deepStrictEqual(quickPick.items, items);
      assert.strictEqual(quickPick.ignoreFocusOut, false);
      assert.strictEqual(quickPick.canSelectMany, false);
      assert.deepStrictEqual(selectedItems, []);
    });

    it("should create a QuickPick with provided options", async () => {
      const items = [{ label: "Item 1" }];
      const options: EnhancedQuickPickOptions<any> = {
        placeHolder: "Select an item",
        ignoreFocusOut: true,
        title: "Test QuickPick",
        canSelectMany: true,
        buttons: [{ iconPath: new vscode.ThemeIcon("refresh") }],
      };

      const quickPickPromise = createEnhancedQuickPick(items, options);

      // Trigger hide to resolve the promise
      const hideHandler = onDidHideStub.args[0][0];
      hideHandler();

      const { quickPick, selectedItems } = await quickPickPromise;

      // Verify options were applied
      assert.strictEqual(quickPick.placeholder, options.placeHolder);
      assert.strictEqual(quickPick.ignoreFocusOut, options.ignoreFocusOut);
      assert.strictEqual(quickPick.title, options.title);
      assert.strictEqual(quickPick.canSelectMany, options.canSelectMany);
      assert.deepStrictEqual(quickPick.buttons, options.buttons);
      assert.deepStrictEqual(selectedItems, []);
    });
  });

  describe("Items handling", () => {
    it("should handle non-Promise items", async () => {
      const items = [{ label: "Item 1" }, { label: "Item 2" }];

      const directQuickPickPromise = createEnhancedQuickPick(items);
      const hideHandler = onDidHideStub.args[0][0];
      hideHandler();

      const { quickPick, selectedItems } = await directQuickPickPromise;
      assert.deepStrictEqual(quickPick.items, items);
      assert.deepStrictEqual(selectedItems, []);
    });

    it("should handle Promised items", async () => {
      const items = [{ label: "Item 1" }, { label: "Item 2" }];
      const itemsPromise = Promise.resolve(items);

      const promisedQuickPickPromise = createEnhancedQuickPick(itemsPromise);
      assert.strictEqual(quickPickMock.busy, true);

      await itemsPromise;
      await new Promise(process.nextTick);

      assert.strictEqual(quickPickMock.busy, false);
      assert.deepStrictEqual(quickPickMock.items, items);

      const hideHandler = onDidHideStub.args[0][0];
      hideHandler();

      const { quickPick, selectedItems } = await promisedQuickPickPromise;
      assert.deepStrictEqual(quickPick.items, items);
      assert.deepStrictEqual(selectedItems, []);
    });

    it("should handle selected items with promised items", async () => {
      const items = [{ label: "Item 1" }, { label: "Item 2" }];
      const selectedItems = [items[1]];
      const itemsPromise = Promise.resolve(items);

      const quickPickPromise = createEnhancedQuickPick(itemsPromise, { selectedItems });

      await itemsPromise;
      await new Promise(process.nextTick);
      // make sure items are pre-selected in the QuickPick
      sinon.assert.match(quickPickMock, {
        selectedItems: selectedItems,
      });

      // simulate user accepting the QuickPick by triggering the onDidAccept handler, which is
      // required for any returned selectedItems
      const acceptHandler = onDidAcceptStub.args[0][0];
      acceptHandler();

      sinon.assert.calledOnce(hideStub);

      const hideHandler = onDidHideStub.args[0][0];
      hideHandler();
      const { quickPick, selectedItems: resultSelectedItems } = await quickPickPromise;
      assert.deepStrictEqual(quickPick.selectedItems, selectedItems);
      assert.deepStrictEqual(resultSelectedItems, selectedItems);
    });

    it("should not return selectedItems when QuickPick is hidden without accepting", async () => {
      // set up quickpick with items and pre-selected items
      const items = [{ label: "Item 1" }, { label: "Item 2" }];
      const preSelectedItems = [items[0]];
      const quickPickPromise = createEnhancedQuickPick(items, {
        selectedItems: preSelectedItems,
        canSelectMany: true,
      });

      // make sure items are pre-selected in the QuickPick
      sinon.assert.match(quickPickMock, {
        selectedItems: preSelectedItems,
      });

      // hide the QuickPick without calling onDidAccept
      const hideHandler = onDidHideStub.args[0][0];
      hideHandler();

      const { selectedItems } = await quickPickPromise;

      // selectedItems should be empty despite having pre-selected items
      assert.deepStrictEqual(selectedItems, []);
    });
  });

  describe("Event handlers", () => {
    it("should register and trigger all event handlers", async () => {
      const handlers = {
        onSelectionChange: sandbox.stub(),
        onActiveItemChange: sandbox.stub(),
        onItemButtonClicked: sandbox.stub(),
        onButtonClicked: sandbox.stub(),
        onDidAccept: sandbox.stub(),
      };

      const quickPickPromise = createEnhancedQuickPick([], handlers);

      // Verify handlers were registered
      sinon.assert.called(onDidChangeSelectionStub);
      sinon.assert.called(onDidChangeActiveStub);
      sinon.assert.called(onDidTriggerItemButtonStub);
      sinon.assert.called(onDidTriggerButtonStub);
      sinon.assert.called(onDidAcceptStub);

      // Simulate events
      const selectedItems = [{ label: "Selected" }];
      const activeItems = [{ label: "Active" }];
      const buttonEvent = {
        button: { iconPath: new vscode.ThemeIcon("trash") },
        item: { label: "Item" },
      };
      const button = { iconPath: new vscode.ThemeIcon("refresh") };

      // Trigger handlers
      onDidChangeSelectionStub.args[0][0](selectedItems);
      onDidChangeActiveStub.args[0][0](activeItems);
      onDidTriggerItemButtonStub.args[0][0](buttonEvent);
      onDidTriggerButtonStub.args[0][0](button);
      onDidAcceptStub.args[0][0]();

      // Verify handlers were called with correct arguments
      sinon.assert.calledWith(handlers.onSelectionChange, selectedItems, quickPickMock);
      sinon.assert.calledWith(handlers.onActiveItemChange, activeItems[0], quickPickMock);
      sinon.assert.calledWith(handlers.onItemButtonClicked, {
        button: buttonEvent.button,
        item: buttonEvent.item,
        quickPick: quickPickMock,
      });
      sinon.assert.calledWith(handlers.onButtonClicked, button, quickPickMock);
      sinon.assert.calledWith(handlers.onDidAccept, quickPickMock);

      // Trigger hide to resolve the promise
      const hideHandler = onDidHideStub.args[0][0];
      hideHandler();
      const { selectedItems: resultSelectedItems } = await quickPickPromise;
      assert.deepStrictEqual(resultSelectedItems, []);
    });
  });
});
