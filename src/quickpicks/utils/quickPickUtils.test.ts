import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import "mocha";
import { createEnhancedQuickPick, EnhancedQuickPickOptions } from "./quickPickUtils";

describe("createEnhancedQuickPick", () => {
  let sandbox: sinon.SinonSandbox;
  let quickPickMock: any;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // Create a mock for the QuickPick object
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
      onDidChangeSelection: sandbox.stub().returns({ dispose: sandbox.stub() }),
      onDidChangeActive: sandbox.stub().returns({ dispose: sandbox.stub() }),
      onDidTriggerItemButton: sandbox.stub().returns({ dispose: sandbox.stub() }),
      onDidTriggerButton: sandbox.stub().returns({ dispose: sandbox.stub() }),
      onDidAccept: sandbox.stub().returns({ dispose: sandbox.stub() }),
      dispose: sandbox.stub(),
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("Basic configuration", () => {
    it("should create a QuickPick with default options when no options provided", () => {
      const items = [{ label: "Item 1" }];
      createEnhancedQuickPick(items);

      assert.equal(quickPickMock.ignoreFocusOut, false);
      assert.equal(quickPickMock.canSelectMany, false);
      assert.equal(quickPickMock.matchOnDescription, false);
      assert.equal(quickPickMock.matchOnDetail, false);
      assert.deepEqual(quickPickMock.buttons, []);
      assert.deepEqual(quickPickMock.items, items);
    });

    it("should create a QuickPick with provided options", () => {
      const items = [{ label: "Item 1" }];
      const options: EnhancedQuickPickOptions<vscode.QuickPickItem> = {
        placeHolder: "Select an item",
        ignoreFocusOut: true,
        title: "Test QuickPick",
        canSelectMany: true,
        matchOnDescription: true,
        matchOnDetail: true,
        buttons: [{ iconPath: new vscode.ThemeIcon("refresh") }],
      };

      createEnhancedQuickPick(items, options);

      assert.equal(quickPickMock.placeholder, options.placeHolder);
      assert.equal(quickPickMock.ignoreFocusOut, options.ignoreFocusOut);
      assert.equal(quickPickMock.title, options.title);
      assert.equal(quickPickMock.canSelectMany, options.canSelectMany);
      assert.equal(quickPickMock.matchOnDescription, options.matchOnDescription);
      assert.equal(quickPickMock.matchOnDetail, options.matchOnDetail);
      assert.deepEqual(quickPickMock.buttons, options.buttons);
    });
  });

  describe("Items handling", () => {
    it("should set items directly when array is provided", () => {
      const items = [{ label: "Item 1" }, { label: "Item 2" }];
      createEnhancedQuickPick(items);
      assert.deepEqual(quickPickMock.items, items);
    });

    it("should handle promised items correctly", async () => {
      const items = [{ label: "Item 1" }, { label: "Item 2" }];
      const itemsPromise = Promise.resolve(items);

      createEnhancedQuickPick(itemsPromise);
      assert.equal(quickPickMock.busy, true);

      await itemsPromise;
      // Use process.nextTick to allow the async function to complete
      await new Promise(process.nextTick);

      assert.equal(quickPickMock.busy, false);
      assert.deepEqual(quickPickMock.items, items);
    });

    it("should set selectedItems after promised items are loaded", async () => {
      const items = [{ label: "Item 1" }, { label: "Item 2" }];
      const selectedItems = [items[1]];
      const itemsPromise = Promise.resolve(items);

      createEnhancedQuickPick(itemsPromise, { selectedItems });
      await itemsPromise;
      await new Promise(process.nextTick);

      assert.deepEqual(quickPickMock.selectedItems, selectedItems);
    });
  });

  describe("Event handlers", () => {
    it("should register onSelectionChange handler when provided", () => {
      const onSelectionChange = sandbox.stub();
      createEnhancedQuickPick([], { onSelectionChange });

      sinon.assert.calledOnce(quickPickMock.onDidChangeSelection);

      // Simulate selection change
      const handler = quickPickMock.onDidChangeSelection.getCall(0).args[0];
      const selectedItems = [{ label: "Selected" }];
      handler(selectedItems);

      sinon.assert.calledWith(onSelectionChange, selectedItems, quickPickMock);
    });

    it("should register onActiveItemChange handler when provided", () => {
      const onActiveItemChange = sandbox.stub();
      createEnhancedQuickPick([], { onActiveItemChange });

      sinon.assert.calledOnce(quickPickMock.onDidChangeActive);

      // Simulate active item change
      const handler = quickPickMock.onDidChangeActive.getCall(0).args[0];
      const activeItems = [{ label: "Active" }];
      handler(activeItems);

      sinon.assert.calledWith(onActiveItemChange, activeItems[0], quickPickMock);
    });

    it("should register onItemButtonClicked handler when provided", () => {
      const onItemButtonClicked = sandbox.stub();
      createEnhancedQuickPick([], { onItemButtonClicked });

      sinon.assert.calledOnce(quickPickMock.onDidTriggerItemButton);

      // Simulate button click
      const handler = quickPickMock.onDidTriggerItemButton.getCall(0).args[0];
      const event = {
        button: { iconPath: new vscode.ThemeIcon("trash") },
        item: { label: "Item" },
      };
      handler(event);

      sinon.assert.calledWith(onItemButtonClicked, {
        button: event.button,
        item: event.item,
        quickPick: quickPickMock,
      });
    });

    it("should register onButtonClicked handler when provided", () => {
      const onButtonClicked = sandbox.stub();
      createEnhancedQuickPick([], { onButtonClicked });

      sinon.assert.calledOnce(quickPickMock.onDidTriggerButton);

      // Simulate button click
      const handler = quickPickMock.onDidTriggerButton.getCall(0).args[0];
      const button = { iconPath: new vscode.ThemeIcon("refresh") };
      handler(button);

      sinon.assert.calledWith(onButtonClicked, button, quickPickMock);
    });

    it("should register onDidAccept handler when provided", () => {
      const onDidAccept = sandbox.stub();
      createEnhancedQuickPick([], { onDidAccept });

      sinon.assert.calledOnce(quickPickMock.onDidAccept);

      // Simulate accept
      const handler = quickPickMock.onDidAccept.getCall(0).args[0];
      handler();

      sinon.assert.calledWith(onDidAccept, quickPickMock);
    });
  });
});
