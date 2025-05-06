import * as assert from "assert";
import * as sinon from "sinon";
import { QuickPick, QuickPickItem, QuickPickItemKind, TextEditor, window } from "vscode";
import * as uris from "./uris";

describe.only("uriQuickPick", () => {
  let sandbox: sinon.SinonSandbox;
  let clock: sinon.SinonFakeTimers;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    clock = sandbox.useFakeTimers();
  });

  afterEach(async () => {
    // Run any remaining timers
    try {
      await clock.runAllAsync();
    } catch (e) {
      // Ignore timer errors during cleanup
    }
    sandbox.restore();
  });

  // Helper function to handle QuickPick lifecycle
  async function handleQuickPickLifecycle(quickPick: any, promise: Promise<any>) {
    // Initial tick to allow setup
    await clock.tickAsync(1);

    // Ensure onDidHide is called
    const hideCall = quickPick.onDidHide.getCall(0);
    if (hideCall?.args?.[0]) {
      hideCall.args[0]();
    }

    // Allow promise to resolve
    await clock.tickAsync(1);

    // Wait for the quickpick promise with a timeout
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("QuickPick timeout")), 1000);
    });

    await Promise.race([promise, timeoutPromise]);

    return promise;
  }

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
      items: [] as QuickPickItem[],
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

    const quickpickPromise = uris.uriQuickpick(["file"], ["javascript"]);
    await handleQuickPickLifecycle(fakeQuickPick, quickpickPromise);

    sinon.assert.callOrder(fakeQuickPickStub, fakeQuickPick.show);
    sinon.assert.calledOnce(fakeQuickPick.onDidHide);

    assert.strictEqual(fakeQuickPick.items.length, 1);
  });

  it("should handle no matching editors", async () => {
    sinon.stub(window, "tabGroups").value({
      all: [{ tabs: [] }],
    });

    const fakeQuickPick = {
      items: [] as QuickPickItem[],
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
    sandbox.stub(window, "createQuickPick").returns(fakeRealQuickPick);

    const quickpickPromise = uris.uriQuickpick(["file"], ["javascript"]);
    await handleQuickPickLifecycle(fakeQuickPick, quickpickPromise);

    assert.strictEqual(fakeQuickPick.items.length, 1);
    assert.strictEqual(fakeQuickPick.items[0].label, "Open File...");
    assert.ok(!fakeQuickPick.items.some((item) => item.kind === QuickPickItemKind.Separator));
  });
});
