import sinon from "sinon";
import * as vscode from "vscode";
import { uriQuickpick } from "./uris";

describe.only("uriQuickpick", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should resolve with the selected file URI from the quickpick", async () => {
    const mockUri = vscode.Uri.file("/path/to/mock/file.txt");

    // Mock vscode.window.createQuickPick
    const quickPickStub: Pick<
      vscode.QuickPick<vscode.QuickPickItem>,
      "items" | "placeholder" | "activeItems" | "show" | "hide" | "onDidAccept" | "onDidHide"
    > = {
      items: [],
      placeholder: "",
      activeItems: [],
      show: sandbox.stub(),
      hide: sandbox.stub(),
      onDidAccept: sandbox.stub(),
      onDidHide: sandbox.stub(),
    };
    sandbox.stub(vscode.window, "createQuickPick").returns(quickPickStub as any);

    // Mock vscode.window.activeTextEditor
    sandbox.stub(vscode.window, "activeTextEditor").value({
      document: {
        fileName: "/path/to/active/file.txt",
        languageId: "plaintext",
        uri: mockUri,
      },
    });

    // Mock vscode.workspace.openTextDocument
    sandbox.stub(vscode.workspace, "openTextDocument").resolves({
      fileName: "/path/to/mock/file.txt",
      languageId: "plaintext",
      uri: mockUri,
    } as vscode.TextDocument);

    // Simulate user selecting the file
    const onDidAcceptEmitter = new vscode.EventEmitter<void>();
    sandbox.stub(quickPickStub, "onDidAccept").get(() => onDidAcceptEmitter.event);
    quickPickStub.activeItems = [{ label: "/path/to/mock/file.txt" }];
    onDidAcceptEmitter.fire();

    const result = await uriQuickpick();
    sinon.assert.match(result?.fsPath, mockUri.fsPath);
  });

  it("should resolve with undefined when the quickpick is canceled", async () => {
    // Mock vscode.window.createQuickPick
    const quickPickStub: Pick<
      vscode.QuickPick<vscode.QuickPickItem>,
      "items" | "placeholder" | "activeItems" | "show" | "hide" | "onDidAccept" | "onDidHide"
    > = {
      items: [],
      placeholder: "",
      activeItems: [],
      show: sandbox.stub(),
      hide: sandbox.stub(),
      onDidAccept: sandbox.stub(),
      onDidHide: sandbox.stub(),
    };
    sandbox.stub(vscode.window, "createQuickPick").returns(quickPickStub as any);

    // Simulate user canceling the quickpick
    const onDidHideEmitter = new vscode.EventEmitter<void>();
    sandbox.stub(quickPickStub, "onDidHide").get(() => onDidHideEmitter.event);
    sandbox.stub(quickPickStub, "hide").callsFake(() => {
      onDidHideEmitter.fire();
    });

    const result = await uriQuickpick();
    sinon.assert.match(result, undefined);
  });

  it("should resolve with a file URI when the file chooser is used", async () => {
    const mockUri = vscode.Uri.file("/path/to/selected/file.txt");

    // Mock vscode.window.createQuickPick
    const quickPickStub: vscode.QuickPick<vscode.QuickPickItem> = {
      items: [],
      placeholder: "",
      activeItems: [],
      show: sandbox.stub(),
      hide: sandbox.stub(),
      onDidAccept: sandbox.stub(),
      onDidHide: sandbox.stub(),
      value: "",
      onDidChangeValue: new vscode.EventEmitter<string>().event,
      buttons: [],
      onDidTriggerButton: new vscode.EventEmitter<vscode.QuickInputButton>().event,
      onDidTriggerItemButton: new vscode.EventEmitter<
        vscode.QuickPickItemButtonEvent<vscode.QuickPickItem>
      >().event,
      canSelectMany: false,
      matchOnDescription: false,
      matchOnDetail: false,
      onDidChangeActive: new vscode.EventEmitter<readonly vscode.QuickPickItem[]>().event,
      selectedItems: [],
      onDidChangeSelection: new vscode.EventEmitter<readonly vscode.QuickPickItem[]>().event,
      title: undefined,
      step: undefined,
      totalSteps: undefined,
      enabled: false,
      busy: false,
      ignoreFocusOut: false,
      dispose: function (): void {
        throw new Error("Function not implemented.");
      },
    };
    sandbox.stub(vscode.window, "createQuickPick").returns(quickPickStub as any);

    // Mock vscode.window.showOpenDialog
    sandbox.stub(vscode.window, "showOpenDialog").resolves([mockUri]);

    // Simulate user selecting "Open File..." and using the file chooser
    const onDidAcceptEmitter = new vscode.EventEmitter<void>();
    sandbox.stub(quickPickStub, "onDidAccept").get(() => onDidAcceptEmitter.event);
    quickPickStub.activeItems = [{ label: "Open File..." }];
    onDidAcceptEmitter.fire();

    const result = await uriQuickpick();
    sinon.assert.match(result?.fsPath, mockUri.fsPath);
  });
});
