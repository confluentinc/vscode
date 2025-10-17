import { afterEach, beforeEach, describe } from "mocha";
import * as sinon from "sinon";
import * as vscode from "vscode";

// External module imports to stub
import { getSidecarStub } from "../../../tests/stubs/sidecar";
import { type TemplatesScaffoldV1Api } from "../../clients/scaffoldingService";
import * as templatesModule from "../../projectGeneration/templates";
import * as sidecarModule from "../../sidecar";
import { WebviewPanelCache } from "../../webview-cache";
import * as webviewCommsModule from "../../webview/comms/comms";

// Type-safe constants
const TEST_TEMPLATE_COLLECTION = "vscode";
const TEST_TEMPLATE_NAME = "example-template";

describe.only("scaffoldUtils", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // Stub VS Code window APIs
    sandbox.stub(vscode.window, "showOpenDialog").resolves(undefined);
    sandbox.stub(vscode.window, "showErrorMessage").resolves(undefined);
    sandbox.stub(vscode.window, "showInformationMessage").resolves(undefined);
    sandbox.stub(vscode.window, "withProgress").callsFake(async (_opts, task) => {
      return await task({ report: () => void 0 }, new vscode.CancellationTokenSource().token);
    });

    // Stub commands
    sandbox.stub(vscode.commands, "executeCommand").resolves(undefined);

    // Stub workspace FS
    sandbox.stub(vscode.workspace.fs, "writeFile").resolves();

    // Stub sidecar via shared test helper
    const stubbedSidecar = getSidecarStub(sandbox);
    const fakeTemplatesApi: Pick<TemplatesScaffoldV1Api, "applyScaffoldV1Template"> = {
      applyScaffoldV1Template: sandbox.stub().resolves(new Blob([new Uint8Array([1, 2, 3])])),
    };
    stubbedSidecar.getTemplatesApi.returns(fakeTemplatesApi as TemplatesScaffoldV1Api);
    sandbox.stub(sidecarModule, "getSidecar").resolves(stubbedSidecar as any);

    // Stub template listing & picking
    sandbox.stub(templatesModule, "getTemplatesList").resolves([
      {
        spec: {
          name: TEST_TEMPLATE_NAME,
          display_name: "Example Template",
          template_collection: { id: TEST_TEMPLATE_COLLECTION },
          options: {},
          tags: ["producer"],
        },
      },
    ] as any);
    sandbox.stub(templatesModule, "pickTemplate").resolves({
      spec: {
        name: TEST_TEMPLATE_NAME,
        display_name: "Example Template",
        template_collection: { id: TEST_TEMPLATE_COLLECTION },
        options: {},
      },
    } as any);

    // Stub webview message handling
    sandbox.stub(webviewCommsModule, "handleWebviewMessage").returns({
      dispose: () => void 0,
    } as vscode.Disposable);

    // Stub WebviewPanelCache behavior
    sandbox.stub(WebviewPanelCache.prototype, "findOrCreate").returns([
      {
        reveal: () => void 0,
        dispose: () => void 0,
        onDidDispose: () => void 0,
        webview: {} as vscode.Webview,
      } as any,
      false,
    ]);
  });

  afterEach(() => {
    sandbox.restore();
  });

  // ...future test cases (e.g., applyTemplate success, error handling, URI parsing) will go here...
});
