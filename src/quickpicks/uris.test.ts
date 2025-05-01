import * as assert from "assert";
import * as sinon from "sinon";
import { QuickPick, QuickPickItem, TextEditor, window } from "vscode";
import * as uris from "./uris";
describe.only("uriQuickPick", () => {
  let sandbox: sinon.SinonSandbox;
  let clock: sinon.SinonFakeTimers;
  beforeEach(() => {
    sandbox = sinon.createSandbox();
    clock = sandbox.useFakeTimers();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should use a mocked activeTextEditor", async () => {
    const fakeEditor = {
      document: {
        uri: {
          scheme: "file://",
        },
        languageId: "javascript",
        fileName: "test.js",
      },
    } as TextEditor;
    sinon.stub(window, "activeTextEditor").value(fakeEditor);
    sinon.stub(window, "tabGroups").value({
      all: [],
    });
    const fakeQuickPick = {
      items: [],
      hide: sandbox.stub(),
      onDidAccept: sandbox.stub(),
      onDidHide: sandbox.stub(),
      show: sandbox.stub(),
      bullshit: sandbox.stub(),
    };
    const fakeRealQuickPick = fakeQuickPick as unknown as QuickPick<QuickPickItem>;
    const fakeQuickPickStub = sandbox.stub(window, "createQuickPick");
    fakeQuickPickStub.returns(fakeRealQuickPick);

    // set the quickpick into motion

    uris.uriQuickpick(["file"], ["javascript"]);
    clock.tick(1);
    const handler = fakeQuickPick.onDidHide.getCall(0).args[0] as () => void;
    handler();
    clock.tick(1);
    sinon.assert.calledOnce(fakeQuickPickStub);
    assert.strictEqual(fakeQuickPick.items.length, 2);
  });
});
