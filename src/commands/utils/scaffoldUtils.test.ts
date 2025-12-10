import * as sinon from "sinon";
import * as unzipitModule from "unzipit";
import * as vscode from "vscode";
import { getSidecarStub } from "../../../tests/stubs/sidecar";
import { createResponseError, ResponseErrorSource } from "../../../tests/unit/testUtils";
import { TemplatesScaffoldV1Api } from "../../clients/scaffoldingService";
import * as templatesModule from "../../projectGeneration/templates";
import { WebviewPanelCache } from "../../webview-cache";
import * as webviewCommsModule from "../../webview/comms/comms";

const TEST_TEMPLATE_COLLECTION = "vscode";
const TEST_TEMPLATE_NAME = "example-template";

describe("scaffoldUtils", () => {
  let sandbox: sinon.SinonSandbox;
  let stubbedSidecar: sinon.SinonStubbedInstance<any>;
  let stubbedTemplatesApi: sinon.SinonStubbedInstance<TemplatesScaffoldV1Api>;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // VS Code APIs
    sandbox.stub(vscode.window, "showOpenDialog").resolves(undefined);
    sandbox.stub(vscode.window, "showErrorMessage").resolves(undefined);
    sandbox.stub(vscode.window, "showInformationMessage").resolves(undefined);
    sandbox.stub(vscode.window, "withProgress").callsFake(async (_opts, task) => {
      return await task({ report: () => void 0 }, new vscode.CancellationTokenSource().token);
    });
    sandbox.stub(vscode.commands, "executeCommand").resolves(undefined);

    // Sidecar & TemplatesScaffoldV1Api
    stubbedSidecar = getSidecarStub(sandbox);
    stubbedTemplatesApi = sandbox.createStubInstance(TemplatesScaffoldV1Api);
    stubbedTemplatesApi.applyScaffoldV1Template.resolves(new Blob([new Uint8Array([1, 2, 3])]));
    stubbedSidecar.getTemplatesApi.returns(stubbedTemplatesApi);

    // Template listing & picking defaults
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

    // Webview message handling & WebviewPanelCache behavior
    sandbox.stub(webviewCommsModule, "handleWebviewMessage").returns({
      dispose: () => void 0,
    } as vscode.Disposable);
    sandbox.stub(WebviewPanelCache.prototype, "findOrCreate").returns([
      {
        reveal: () => void 0,
        dispose: () => void 0,
        onDidDispose: () => void 0,
        webview: {} as vscode.Webview,
      } as any,
      false,
    ]);

    // unzipit module for zip extraction tests
    sandbox.stub(unzipitModule, "unzip").resolves({
      entries: {},
    } as any);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("applyTemplate error handling", () => {
    it("should handle 403 errors with proxy-specific messaging", async () => {
      const error403 = createResponseError(
        403,
        "Forbidden",
        JSON.stringify({ message: "Forbidden" }),
        ResponseErrorSource.ScaffoldingService,
      );

      stubbedTemplatesApi.applyScaffoldV1Template.rejects(error403);

      const template = {
        spec: {
          name: TEST_TEMPLATE_NAME,
          display_name: "Test Template",
          template_collection: { id: TEST_TEMPLATE_COLLECTION },
        },
      } as any;

      const { applyTemplate } = await import("./scaffoldUtils");
      const result = await applyTemplate(template, {}, "test");

      sinon.assert.match(result.success, false);
      sinon.assert.match(result.message, sinon.match(/may be caused by a corporate proxy or VPN/i));
    });

    it("should handle JSON parsing errors in response", async () => {
      const errorWithResponse = createResponseError(
        400,
        "Bad Request",
        "Not valid JSON at all!",
        ResponseErrorSource.ScaffoldingService,
      );

      stubbedTemplatesApi.applyScaffoldV1Template.rejects(errorWithResponse);

      const template = {
        spec: {
          name: TEST_TEMPLATE_NAME,
          display_name: "Test Template",
          template_collection: { id: TEST_TEMPLATE_COLLECTION },
        },
      } as any;

      const { applyTemplate } = await import("./scaffoldUtils");
      const result = await applyTemplate(template, {}, "test");

      sinon.assert.match(result.success, false);
      sinon.assert.match(result.message, sinon.match(/Unable to parse error response/));
    });

    it("should handle errors with structured details", async () => {
      const errorWithStructured = createResponseError(
        400,
        "Validation Error",
        JSON.stringify({
          errors: [
            {
              detail: "Must be a valid format for server",
              source: { pointer: "/options/bootstrapServer" },
            },
          ],
        }),
        ResponseErrorSource.ScaffoldingService,
      );

      stubbedTemplatesApi.applyScaffoldV1Template.rejects(errorWithStructured);

      const template = {
        spec: {
          name: TEST_TEMPLATE_NAME,
          display_name: "Test Template",
          template_collection: { id: TEST_TEMPLATE_COLLECTION },
        },
      } as any;

      const { applyTemplate } = await import("./scaffoldUtils");
      const result = await applyTemplate(template, {}, "test");

      sinon.assert.match(result.success, false);
      // make sure it includes the pointer to the invalid field
      sinon.assert.match(result.message, sinon.match(/bootstrapServer/));
    });

    it("should handle errors without response object", async () => {
      const plainError = new Error("Network connection failed");

      stubbedTemplatesApi.applyScaffoldV1Template.rejects(plainError);

      const template = {
        spec: {
          name: TEST_TEMPLATE_NAME,
          display_name: "Test Template",
          template_collection: { id: TEST_TEMPLATE_COLLECTION },
        },
      } as any;

      const { applyTemplate } = await import("./scaffoldUtils");
      const result = await applyTemplate(template, {}, "test");

      sinon.assert.match(result.success, false);
      sinon.assert.match(result.message, sinon.match(/Network connection failed/));
    });

    it("should handle errors during zip extraction", async () => {
      stubbedTemplatesApi.applyScaffoldV1Template.resolves(new Blob([new Uint8Array([1, 2, 3])]));

      (vscode.window.showOpenDialog as sinon.SinonStub).resolves([
        vscode.Uri.file("/test/directory"),
      ]);

      (unzipitModule.unzip as sinon.SinonStub).rejects(new Error("Permission denied"));

      const template = {
        spec: {
          name: TEST_TEMPLATE_NAME,
          display_name: "Test Template",
          template_collection: { id: TEST_TEMPLATE_COLLECTION },
        },
      } as any;

      const { applyTemplate } = await import("./scaffoldUtils");
      const result = await applyTemplate(template, {}, "test");

      sinon.assert.match(result.success, false);
      sinon.assert.match(result.message, sinon.match(/saving extracted template files to disk/));
    });
  });

  describe("parseErrorDetails", () => {
    it("should handle string errors", async () => {
      const { scaffoldProjectRequest } = await import("./scaffoldUtils");
      (templatesModule.getTemplatesList as sinon.SinonStub).rejects("Simple string error");

      const result = await scaffoldProjectRequest({});

      sinon.assert.match(result.success, false);
      // The message includes the stage-specific prefix plus the error details
      sinon.assert.match(
        result.message,
        sinon.match(/Unable to list the templates|Simple string error/),
      );
    });

    it("should handle ResponseError with error arrays", async () => {
      const errorWithArray = createResponseError(
        400,
        "Validation Failed",
        JSON.stringify({
          errors: [
            { detail: "Error 1", message: "Message 1" },
            { detail: "Error 2", message: "Message 2" },
          ],
        }),
        ResponseErrorSource.ScaffoldingService,
      );

      const { scaffoldProjectRequest } = await import("./scaffoldUtils");
      (templatesModule.getTemplatesList as sinon.SinonStub).rejects(errorWithArray);

      const result = await scaffoldProjectRequest({});

      sinon.assert.match(result.success, false);
      sinon.assert.match(result.message, sinon.match(/Error 1; Error 2/));
    });

    it("should handle plain object errors", async () => {
      const objectError = { message: "Custom error object" };

      const { scaffoldProjectRequest } = await import("./scaffoldUtils");
      (templatesModule.getTemplatesList as sinon.SinonStub).rejects(objectError);

      const result = await scaffoldProjectRequest({});

      sinon.assert.match(result.success, false);
      sinon.assert.match(result.message, sinon.match(/Custom error object/));
    });
  });
});
