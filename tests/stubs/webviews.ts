import type { SinonSandbox, SinonStub } from "sinon";
import type {
  Webview,
  WebviewOptions,
  WebviewPanel,
  WebviewPanelOptions,
  WebviewView,
} from "vscode";

/**
 * The {@link Webview} interface, where all methods are replaced with {@link SinonStub stubs}.
 * @see https://code.visualstudio.com/api/references/vscode-api#Webview
 */
interface StubbedWebviewInterface extends Webview {
  onDidReceiveMessage: SinonStub;
  postMessage: SinonStub;
  asWebviewUri: SinonStub;
}

/** A stubbed implementation of the {@link Webview} interface for testing. */
export class StubbedWebview implements StubbedWebviewInterface {
  public options: WebviewOptions = {};
  public html = "";
  public cspSource = "vscode-webview://test";
  public readonly onDidReceiveMessage: SinonStub;
  public readonly postMessage: SinonStub;
  public readonly asWebviewUri: SinonStub;

  constructor(sandbox: SinonSandbox) {
    this.onDidReceiveMessage = sandbox.stub().returns({ dispose: () => {} });
    this.postMessage = sandbox.stub().resolves();
    this.asWebviewUri = sandbox.stub().callsFake((uri) => uri);
  }
}

/**
 * The {@link WebviewPanel} interface, where all methods are replaced with {@link SinonStub stubs}.
 * @see https://code.visualstudio.com/api/references/vscode-api#WebviewPanel
 */
interface StubbedWebviewPanelInterface extends WebviewPanel {
  onDidChangeViewState: SinonStub;
  onDidDispose: SinonStub;
  reveal: SinonStub;
  dispose: SinonStub;
}

/** A stubbed implementation of the {@link WebviewPanel} interface for testing. */
export class StubbedWebviewPanel implements StubbedWebviewPanelInterface {
  public readonly webview: StubbedWebview;
  public options: WebviewPanelOptions = {};
  public viewType = "test-view-type";
  public title = "Test Webview Panel";
  public iconPath = undefined;
  public viewColumn = undefined;
  public active = true;
  public visible = true;
  public readonly onDidChangeViewState: SinonStub;
  public readonly onDidDispose: SinonStub;
  public readonly reveal: SinonStub;
  public readonly dispose: SinonStub;

  constructor(sandbox: SinonSandbox) {
    this.webview = new StubbedWebview(sandbox);
    this.onDidChangeViewState = sandbox.stub().returns({ dispose: () => {} });
    this.onDidDispose = sandbox.stub().returns({ dispose: () => {} });
    this.reveal = sandbox.stub();
    this.dispose = sandbox.stub();
  }
}

/**
 * The {@link WebviewView} interface, where all methods are replaced with {@link SinonStub stubs}.
 * @see https://code.visualstudio.com/api/references/vscode-api#WebviewView
 */
interface StubbedWebviewViewInterface extends WebviewView {
  show: SinonStub;
  onDidDispose: SinonStub;
  onDidChangeVisibility: SinonStub;
}

/** A stubbed implementation of the {@link WebviewView} interface for testing. */
export class StubbedWebviewView implements StubbedWebviewViewInterface {
  public readonly webview: StubbedWebview;
  public viewType = "test-webview-view";
  public visible = true;
  public title?: string = undefined;
  public description?: string = undefined;
  public badge = undefined;
  public readonly show: SinonStub;
  public readonly onDidDispose: SinonStub;
  public readonly onDidChangeVisibility: SinonStub;

  constructor(sandbox: SinonSandbox) {
    this.webview = new StubbedWebview(sandbox);
    this.show = sandbox.stub();
    this.onDidDispose = sandbox.stub().returns({ dispose: () => {} });
    this.onDidChangeVisibility = sandbox.stub().returns({ dispose: () => {} });
  }
}
