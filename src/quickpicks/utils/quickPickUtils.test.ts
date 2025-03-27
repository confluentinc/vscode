import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import "mocha";
import { createEnhancedQuickPick, EnhancedQuickPickOptions } from "./quickPickUtils";

describe("createEnhancedQuickPick", () => {
  let sandbox: sinon.SinonSandbox;
  let createQuickPickStub: sinon.SinonStub;
  let quickPickMock: vscode.QuickPick<any>;
  let onDidChangeSelectionStub: sinon.SinonStub;
  let onDidChangeActiveStub: sinon.SinonStub;
  let onDidTriggerItemButtonStub: sinon.SinonStub;
  let onDidTriggerButtonStub: sinon.SinonStub;
  let onDidAcceptStub: sinon.SinonStub;
  let onDidHideStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // Create explicit stubs for each event handler
    onDidChangeSelectionStub = sandbox.stub();
    onDidChangeActiveStub = sandbox.stub();
    onDidTriggerItemButtonStub = sandbox.stub();
    onDidTriggerButtonStub = sandbox.stub();
    onDidAcceptStub = sandbox.stub();
    onDidHideStub = sandbox.stub();

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
      hide: sandbox.stub(),
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

      const quickPick = await quickPickPromise;

      // Verify default options and items
      assert.deepStrictEqual(quickPick.items, items);
      assert.strictEqual(quickPick.ignoreFocusOut, false);
      assert.strictEqual(quickPick.canSelectMany, false);
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

      const quickPick = await quickPickPromise;

      // Verify options were applied
      assert.strictEqual(quickPick.placeholder, options.placeHolder);
      assert.strictEqual(quickPick.ignoreFocusOut, options.ignoreFocusOut);
      assert.strictEqual(quickPick.title, options.title);
      assert.strictEqual(quickPick.canSelectMany, options.canSelectMany);
      assert.deepStrictEqual(quickPick.buttons, options.buttons);
    });
  });

  describe("Items handling", () => {
    it("should handle both direct and promised items", async () => {
      const items = [{ label: "Item 1" }, { label: "Item 2" }];
      const itemsPromise = Promise.resolve(items);

      // Test with direct items
      const directQuickPickPromise = createEnhancedQuickPick(items);
      const hideHandler = onDidHideStub.args[0][0];
      hideHandler();
      const directQuickPick = await directQuickPickPromise;
      assert.deepStrictEqual(directQuickPick.items, items);

      // Reset the hide handler stub for the next test
      onDidHideStub.reset();

      // Test with promised items
      const promisedQuickPickPromise = createEnhancedQuickPick(itemsPromise);
      assert.strictEqual(quickPickMock.busy, true);

      // Wait for the promise to resolve and the next tick to process
      await itemsPromise;
      await new Promise(process.nextTick);

      assert.strictEqual(quickPickMock.busy, false);
      assert.deepStrictEqual(quickPickMock.items, items);

      // Trigger hide to resolve the promise
      const promisedHideHandler = onDidHideStub.args[0][0];
      promisedHideHandler();
      const promisedQuickPick = await promisedQuickPickPromise;
      assert.deepStrictEqual(promisedQuickPick.items, items);
    });

    it("should handle selected items with promised items", async () => {
      const items = [{ label: "Item 1" }, { label: "Item 2" }];
      const selectedItems = [items[1]];
      const itemsPromise = Promise.resolve(items);

      const quickPickPromise = createEnhancedQuickPick(itemsPromise, { selectedItems });

      await itemsPromise;
      await new Promise(process.nextTick);

      assert.deepStrictEqual(quickPickMock.selectedItems, selectedItems);

      const hideHandler = onDidHideStub.args[0][0];
      hideHandler();
      const quickPick = await quickPickPromise;
      assert.deepStrictEqual(quickPick.selectedItems, selectedItems);
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
      await quickPickPromise;
    });
  });
});
