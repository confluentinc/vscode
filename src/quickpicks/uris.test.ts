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
      busy: false,
      enabled: true,
      value: "",
      placeholder: "",
      hide: sandbox.stub(),
      dispose: sandbox.stub(),
      onDidAccept: sandbox.stub().returns({ dispose: sandbox.stub() }),
      onDidHide: sandbox.stub().returns({ dispose: sandbox.stub() }),
      onDidChangeValue: sandbox.stub().returns({ dispose: sandbox.stub() }),
      show: sandbox.stub(),
    };
    const fakeRealQuickPick = fakeQuickPick as unknown as QuickPick<QuickPickItem>;
    const fakeQuickPickStub = sandbox.stub(window, "createQuickPick");
    fakeQuickPickStub.returns(fakeRealQuickPick);

    // breaks the event loop, allowing any scheduled promise callbacks to execute before running the timers.
    const quickpickPromise = uris.uriQuickpick(["file"], ["javascript"]);
    await clock.tickAsync(0);

    // Simulate the quickpick being shown and hidden
    const hideHandler = fakeQuickPick.onDidHide.getCall(0).args[0];
    if (hideHandler) {
      hideHandler();
    }
    // wait for next tick
    await clock.tickAsync(0);
    await quickpickPromise;

    // Verify the stubs were called in the right order
    sinon.assert.callOrder(fakeQuickPickStub, fakeQuickPick.show);
    sinon.assert.calledOnce(fakeQuickPick.onDidHide);

    // Verify item was added, only one since we had one active editor in the setup
    assert.strictEqual(fakeQuickPick.items.length, 1);
  });
});
