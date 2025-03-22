import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import "mocha";
import { showEnhancedQuickPick, EnhancedQuickPickOptions } from "./quickPickUtils";

describe("QuickPick utils", () => {
  let sandbox: sinon.SinonSandbox;
  let createQuickPickStub: sinon.SinonStub;
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
      onDidAccept: sandbox.stub(),
      onDidHide: sandbox.stub(),
      dispose: sandbox.stub(),
    };

    // Stub the createQuickPick method
    createQuickPickStub = sandbox.stub(vscode.window, "createQuickPick").returns(quickPickMock);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should create a QuickPick with correct options", async () => {
    const items = [{ label: "Item 1" }, { label: "Item 2" }, { label: "Item 3" }];

    const options: EnhancedQuickPickOptions<vscode.QuickPickItem> = {
      placeHolder: "Select an item",
      ignoreFocusOut: true,
      title: "Test QuickPick",
      canSelectMany: true,
      matchOnDescription: true,
      matchOnDetail: true,
      buttons: [{ iconPath: new vscode.ThemeIcon("refresh"), tooltip: "Refresh" }],
      onButtonClicked: sandbox.stub(),
      onSelectionChange: sandbox.stub(),
      onActiveItemChange: sandbox.stub(),
      onItemButtonClicked: sandbox.stub(),
    };

    // Call the enhanced QuickPick
    const promise = showEnhancedQuickPick(items, options);

    // Verify options were set correctly
    assert.equal(quickPickMock.placeholder, options.placeHolder);
    assert.equal(quickPickMock.ignoreFocusOut, options.ignoreFocusOut);
    assert.equal(quickPickMock.title, options.title);
    assert.equal(quickPickMock.canSelectMany, options.canSelectMany);
    assert.equal(quickPickMock.matchOnDescription, options.matchOnDescription);
    assert.equal(quickPickMock.matchOnDetail, options.matchOnDetail);
    assert.deepEqual(quickPickMock.buttons, options.buttons);
    assert.deepEqual(quickPickMock.items, items);

    // Verify event handlers were registered
    sinon.assert.calledOnce(quickPickMock.onDidChangeSelection);
    sinon.assert.calledOnce(quickPickMock.onDidChangeActive);
    sinon.assert.calledOnce(quickPickMock.onDidTriggerItemButton);
    sinon.assert.calledOnce(quickPickMock.onDidTriggerButton);
    sinon.assert.calledOnce(quickPickMock.onDidAccept);
    sinon.assert.calledOnce(quickPickMock.onDidHide);
    sinon.assert.calledOnce(quickPickMock.show);

    // Trigger accept event with selectedItems
    quickPickMock.selectedItems = [items[1]]; // Select "Item 2"
    const acceptCallback = quickPickMock.onDidAccept.getCall(0).args[0];
    acceptCallback();

    // Verify the QuickPick was hidden
    sinon.assert.calledOnce(quickPickMock.hide);

    // Trigger hide event to resolve the promise
    const hideCallback = quickPickMock.onDidHide.getCall(0).args[0];
    hideCallback();

    // Resolve the promise
    const result = await promise;

    // Verify the result is the selected item
    assert.deepEqual(result, [items[1]]);
  });

  it("should handle promises for items", async () => {
    const items = Promise.resolve([{ label: "Item 1" }, { label: "Item 2" }]);

    // Call the enhanced QuickPick
    const promise = showEnhancedQuickPick(items);

    // Verify busy state
    assert.equal(quickPickMock.busy, true);

    // Resolve the items promise
    const resolvedItems = await items;

    // Now that we're in the next tick, verify the busy state is false
    // and items are set
    assert.equal(quickPickMock.busy, false);
    assert.deepEqual(quickPickMock.items, resolvedItems);

    // Complete the test
    quickPickMock.selectedItems = [resolvedItems[0]];
    const acceptCallback = quickPickMock.onDidAccept.getCall(0).args[0];
    acceptCallback();

    const hideCallback = quickPickMock.onDidHide.getCall(0).args[0];
    hideCallback();

    const result = await promise;
    assert.deepEqual(result, resolvedItems[0]);
  });

  it("should return undefined when no item is selected", async () => {
    const items = [{ label: "Item 1" }];

    // Call the enhanced QuickPick
    const promise = showEnhancedQuickPick(items);

    // Trigger accept event with no selectedItems
    quickPickMock.selectedItems = [];
    const acceptCallback = quickPickMock.onDidAccept.getCall(0).args[0];
    acceptCallback();

    // Trigger hide event
    const hideCallback = quickPickMock.onDidHide.getCall(0).args[0];
    hideCallback();

    // Verify result is undefined
    const result = await promise;
    assert.equal(result, undefined);
  });
});
