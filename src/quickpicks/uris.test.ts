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

  it("should resolve with undefined when the quickpick is canceled", async () => {
    const onDidHideEmitter = new vscode.EventEmitter<void>();
    const onDidAcceptEmitter = new vscode.EventEmitter<void>();
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

    sandbox.stub(vscode.window, "showOpenDialog").resolves([mockUri]);

    const resultPromise = uriQuickpick();

    setTimeout(() => onDidAcceptEmitter.fire(), 10);

    const result = await resultPromise;
    sinon.assert.calledOnce(quickPickStub.show);
    sinon.assert.match(result?.fsPath, mockUri.fsPath);
  });
});
