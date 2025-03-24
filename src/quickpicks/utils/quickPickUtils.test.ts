import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import "mocha";
import { createEnhancedQuickPick, EnhancedQuickPickOptions } from "./quickPickUtils";

describe("createEnhancedQuickPick", () => {
  let sandbox: sinon.SinonSandbox;
  let createQuickPickStub: sinon.SinonStub;
  let quickPickMock: vscode.QuickPick<any>;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // Create a mock for the QuickPick object
    const createEventStub = <T>() => {
      const stub = sandbox.stub() as sinon.SinonStub & vscode.Event<T>;
      stub.returns({ dispose: sandbox.stub() });
      return stub;
    };

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
      onDidChangeSelection: createEventStub<readonly any[]>(),
      onDidChangeActive: createEventStub<readonly any[]>(),
      onDidTriggerItemButton: createEventStub<vscode.QuickPickItemButtonEvent<any>>(),
      onDidTriggerButton: createEventStub<vscode.QuickInputButton>(),
      onDidAccept: createEventStub<void>(),
    } as any;

    // Stub the createQuickPick method to return our mock
    createQuickPickStub = sandbox.stub(vscode.window, "createQuickPick").returns(quickPickMock);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("Basic configuration", () => {
    it("should create a QuickPick with default options when no options provided", () => {
      const items = [{ label: "Item 1" }];
      const quickPick = createEnhancedQuickPick(items);

      // Verify the QuickPick was created
      sinon.assert.calledOnce(createQuickPickStub);

      // Verify default options
      assert.strictEqual(quickPick.ignoreFocusOut, false);
      assert.strictEqual(quickPick.canSelectMany, false);
      assert.strictEqual(quickPick.matchOnDescription, false);
      assert.strictEqual(quickPick.matchOnDetail, false);
      assert.deepStrictEqual(quickPick.buttons, []);

      // Verify items were set
      assert.deepStrictEqual(quickPick.items, items);
    });

    it("should create a QuickPick with provided options", () => {
      const items = [{ label: "Item 1" }];
      const options: EnhancedQuickPickOptions<any> = {
        placeHolder: "Select an item",
        ignoreFocusOut: true,
        title: "Test QuickPick",
        canSelectMany: true,
        matchOnDescription: true,
        matchOnDetail: true,
        buttons: [{ iconPath: new vscode.ThemeIcon("refresh") }],
      };

      const quickPick = createEnhancedQuickPick(items, options);

      // Verify the QuickPick was created with correct options
      assert.strictEqual(quickPick.placeholder, options.placeHolder);
      assert.strictEqual(quickPick.ignoreFocusOut, options.ignoreFocusOut);
      assert.strictEqual(quickPick.title, options.title);
      assert.strictEqual(quickPick.canSelectMany, options.canSelectMany);
      assert.strictEqual(quickPick.matchOnDescription, options.matchOnDescription);
      assert.strictEqual(quickPick.matchOnDetail, options.matchOnDetail);
      assert.deepStrictEqual(quickPick.buttons, options.buttons);
    });
  });

  describe("Items handling", () => {
    it("should set items directly when array is provided", () => {
      const items = [{ label: "Item 1" }, { label: "Item 2" }];
      const quickPick = createEnhancedQuickPick(items);
      assert.deepStrictEqual(quickPick.items, items);
    });

    it("should handle promised items correctly", async () => {
      const items = [{ label: "Item 1" }, { label: "Item 2" }];
      const itemsPromise = Promise.resolve(items);

      const quickPick = createEnhancedQuickPick(itemsPromise);
      assert.strictEqual(quickPick.busy, true);

      await itemsPromise;
      // Wait for the next tick to allow the async function to complete
      await new Promise(process.nextTick);

      assert.strictEqual(quickPick.busy, false);
      assert.deepStrictEqual(quickPick.items, items);
    });

    it("should set selectedItems after promised items are loaded", async () => {
      const items = [{ label: "Item 1" }, { label: "Item 2" }];
      const selectedItems = [items[1]];
      const itemsPromise = Promise.resolve(items);

      const quickPick = createEnhancedQuickPick(itemsPromise, { selectedItems });
      await itemsPromise;
      await new Promise(process.nextTick);

      assert.deepStrictEqual(quickPick.selectedItems, selectedItems);
    });
  });

  describe("Event handlers", () => {
    it("should register onSelectionChange handler when provided", () => {
      const onSelectionChange = sandbox.stub();
      createEnhancedQuickPick([], { onSelectionChange });

      // Verify the handler was registered
      const stub = quickPickMock.onDidChangeSelection as sinon.SinonStub;
      sinon.assert.called(stub);

      // Simulate selection change by calling the registered handler
      const selectedItems = [{ label: "Selected" }];
      const handler = stub.args[0][0];
      handler(selectedItems);

      // Verify our handler was called with correct arguments
      sinon.assert.calledWith(onSelectionChange, selectedItems, quickPickMock);
    });

    it("should register onActiveItemChange handler when provided", () => {
      const onActiveItemChange = sandbox.stub();
      createEnhancedQuickPick([], { onActiveItemChange });

      // Verify the handler was registered
      const stub = quickPickMock.onDidChangeActive as sinon.SinonStub;
      sinon.assert.called(stub);

      // Simulate active item change by calling the registered handler
      const activeItems = [{ label: "Active" }];
      const handler = stub.args[0][0];
      handler(activeItems);

      // Verify our handler was called with correct arguments
      sinon.assert.calledWith(onActiveItemChange, activeItems[0], quickPickMock);
    });

    it("should register onItemButtonClicked handler when provided", () => {
      const onItemButtonClicked = sandbox.stub();
      createEnhancedQuickPick([], { onItemButtonClicked });

      // Verify the handler was registered
      const stub = quickPickMock.onDidTriggerItemButton as sinon.SinonStub;
      sinon.assert.called(stub);

      // Simulate button click by calling the registered handler
      const event = {
        button: { iconPath: new vscode.ThemeIcon("trash") },
        item: { label: "Item" },
      };
      const handler = stub.args[0][0];
      handler(event);

      // Verify our handler was called with correct arguments
      sinon.assert.calledWith(onItemButtonClicked, {
        button: event.button,
        item: event.item,
        quickPick: quickPickMock,
      });
    });

    it("should register onButtonClicked handler when provided", () => {
      const onButtonClicked = sandbox.stub();
      createEnhancedQuickPick([], { onButtonClicked });

      // Verify the handler was registered
      const stub = quickPickMock.onDidTriggerButton as sinon.SinonStub;
      sinon.assert.called(stub);

      // Simulate button click by calling the registered handler
      const button = { iconPath: new vscode.ThemeIcon("refresh") };
      const handler = stub.args[0][0];
      handler(button);

      // Verify our handler was called with correct arguments
      sinon.assert.calledWith(onButtonClicked, button, quickPickMock);
    });

    it("should register onDidAccept handler when provided", () => {
      const onDidAccept = sandbox.stub();
      createEnhancedQuickPick([], { onDidAccept });

      // Verify the handler was registered
      const stub = quickPickMock.onDidAccept as sinon.SinonStub;
      sinon.assert.called(stub);

      // Simulate accept by calling the registered handler
      const handler = stub.args[0][0];
      handler();

      // Verify our handler was called with correct arguments
      sinon.assert.calledWith(onDidAccept, quickPickMock);
    });
  });
});
