import * as assert from "assert";
import sinon from "sinon";
import * as vscode from "vscode";
import { uriQuickpick } from "./uris";

describe.only("uriQuickpick", () => {
  // Remove .only
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should resolve with the selected file URI from the quickpick", async () => {
    // Create a simple absolute path rather than using process.cwd()
    const mockUri = vscode.Uri.file("/path/to/mock/file.txt");
    // Important: Use the exact uri.fsPath format for consistency
    const filename = mockUri.fsPath;

    // Create a mock document that perfectly matches
    const mockDocument = {
      fileName: filename,
      languageId: "plaintext",
      uri: mockUri,
    };

    // Mock the activeTextEditor to return our document
    sandbox.stub(vscode.window, "activeTextEditor").value({
      document: mockDocument,
    });

    // Mock the QuickPick implementation
    const selectFileLabel = "Open File...";
    const onDidAcceptEmitter = new vscode.EventEmitter<void>();
    const onDidHideEmitter = new vscode.EventEmitter<void>();

    // Create a fileItem that exactly matches what the implementation creates
    const fileItem = {
      label: filename,
      description: "plaintext (active)",
      iconPath: new vscode.ThemeIcon("file-code"),
      buttons: [{ iconPath: new vscode.ThemeIcon("check"), tooltip: "Select this file" }],
    };

    // Create the QuickPick items in the same order as the implementation
    const quickPickItems = [
      {
        label: selectFileLabel,
        iconPath: new vscode.ThemeIcon("search"),
        alwaysShow: true,
      },
      {
        kind: vscode.QuickPickItemKind.Separator,
        label: "Current document",
      },
      fileItem,
    ];

    // Create a complete quickpick stub that matches the implementation
    const quickPickStub = {
      items: quickPickItems,
      placeholder: "Select a file",
      activeItems: [fileItem],
      show: sandbox.stub(),
      hide: sandbox.stub().callsFake(() => onDidHideEmitter.fire()),
      onDidAccept: onDidAcceptEmitter.event,
      onDidHide: onDidHideEmitter.event,
      selectedItems: [fileItem],
    };

    sandbox.stub(vscode.window, "createQuickPick").returns(quickPickStub as any);

    // Mock tab groups and documents - these might be relevant for the filenameUriMap
    sandbox.stub(vscode.window, "tabGroups").value({ all: [] });

    // Don't spy on Map.prototype - it's causing issues

    // Start the promise
    const resultPromise = uriQuickpick();

    // Fire the event after a delay to ensure the filenameUriMap is populated
    await new Promise((resolve) => setTimeout(resolve, 100));
    onDidAcceptEmitter.fire();

    // Assert the result
    const result = await resultPromise;

    // For debugging
    if (!result) {
      console.log("Result is undefined!");
      console.log("Expected URI:", mockUri);
      console.log("File item label:", fileItem.label);
    }

    assert.ok(result, "Result should not be undefined");
    assert.strictEqual(result?.fsPath, mockUri.fsPath);
  });

  it("should resolve with undefined when the quickpick is canceled", async () => {
    const onDidHideEmitter = new vscode.EventEmitter<void>();
    const onDidAcceptEmitter = new vscode.EventEmitter<void>();

    // Mock vscode.window.createQuickPick with proper event setup
    const quickPickStub = {
      items: [],
      placeholder: "",
      activeItems: [],
      show: sandbox.stub(),
      hide: sandbox.stub().callsFake(() => {
        onDidHideEmitter.fire();
      }),
      onDidAccept: onDidAcceptEmitter.event,
      onDidHide: onDidHideEmitter.event,
      selectedItems: [],
    };

    sandbox.stub(vscode.window, "createQuickPick").returns(quickPickStub as any);

    // Start the promise
    const resultPromise = uriQuickpick();

    // Simulate user canceling
    setTimeout(() => onDidHideEmitter.fire(), 10);

    const result = await resultPromise;
    sinon.assert.calledOnce(quickPickStub.show);
    sinon.assert.match(result, undefined);
  });

  it("should resolve with a file URI when the file chooser is used", async () => {
    const selectFileLabel = "Open File...";
    const mockUri = vscode.Uri.file("/path/to/selected/file.txt");
    const onDidAcceptEmitter = new vscode.EventEmitter<void>();
    const onDidHideEmitter = new vscode.EventEmitter<void>();

    // Mock vscode.window.createQuickPick with proper event setup
    const quickPickStub = {
      items: [
        { label: selectFileLabel, iconPath: new vscode.ThemeIcon("search"), alwaysShow: true },
      ],
      placeholder: "",
      activeItems: [],
      show: sandbox.stub(),
      hide: sandbox.stub().callsFake(() => {
        onDidHideEmitter.fire();
      }),
      onDidAccept: onDidAcceptEmitter.event,
      onDidHide: onDidHideEmitter.event,
      selectedItems: [{ label: selectFileLabel }],
    };

    sandbox.stub(vscode.window, "createQuickPick").returns(quickPickStub as any);

    // Mock vscode.window.showOpenDialog
    sandbox.stub(vscode.window, "showOpenDialog").resolves([mockUri]);

    // Start the promise
    const resultPromise = uriQuickpick();

    // Simulate user selecting "Open File..."
    setTimeout(() => onDidAcceptEmitter.fire(), 10);

    const result = await resultPromise;
    sinon.assert.calledOnce(quickPickStub.show);
    sinon.assert.match(result?.fsPath, mockUri.fsPath);
  });
});
