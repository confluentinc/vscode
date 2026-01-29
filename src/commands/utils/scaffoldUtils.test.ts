import * as assert from "assert";
import * as sinon from "sinon";
import * as unzipit from "unzipit";
import * as vscode from "vscode";
import type { ScaffoldV1Template } from "../../clients/scaffoldingService";
import * as authnUtils from "../../authn/utils";
import * as templates from "../../projectGeneration/templates";
import * as errors from "../../errors";
import * as notifications from "../../notifications";
import * as fileUtils from "../../utils/file";
import * as fsWrappers from "../../utils/fsWrappers";
import { applyTemplate } from "./scaffoldUtils";

describe("scaffoldUtils", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("applyTemplate", () => {
    it("should return error if template name is missing", async () => {
      const template = { spec: {} } as ScaffoldV1Template;

      const result = await applyTemplate(template, {});

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.message, "Template name is missing");
    });

    it("should call scaffolding API with correct parameters", async () => {
      const template = {
        spec: {
          name: "java-client",
          display_name: "Java Client",
          template_collection: { id: "vscode" },
        },
      } as ScaffoldV1Template;

      const manifestOptions = {
        bootstrap_server: "localhost:9092",
        topic_name: "test-topic",
      };

      // Stub authentication
      sandbox.stub(authnUtils, "getCCloudAuthSession").resolves({
        accessToken: "test-token",
        id: "test-session",
        account: { id: "test", label: "Test" },
        scopes: [],
      });

      // Create mock blob
      const mockBlob = new Blob(["test content"], { type: "application/zip" });

      // Stub the API
      const applyTemplateStub = sandbox.stub().resolves(mockBlob);
      sandbox.stub(templates, "createScaffoldingApi").returns({
        applyScaffoldV1Template: applyTemplateStub,
        listScaffoldV1Templates: sandbox.stub(),
      } as any);

      // Stub file dialogs and operations
      const testUri = vscode.Uri.file("/tmp/test-project");
      sandbox.stub(vscode.window, "showOpenDialog").resolves([testUri]);
      sandbox.stub(fileUtils, "fileUriExists").resolves(false);
      sandbox.stub(fsWrappers, "writeFile").resolves();
      sandbox.stub(vscode.window, "showInformationMessage").resolves(undefined);
      // Stub unzip to avoid trying to extract non-zip content
      sandbox.stub(unzipit, "unzip").resolves({ entries: {}, zip: {} } as any);

      const result = await applyTemplate(template, manifestOptions);

      assert.strictEqual(result.success, true);
      sinon.assert.calledOnce(applyTemplateStub);
      sinon.assert.calledWithMatch(applyTemplateStub, {
        template_collection_name: "vscode",
        name: "java-client",
        ApplyScaffoldV1TemplateRequest: {
          options: {
            bootstrap_server: "localhost:9092",
            topic_name: "test-topic",
          },
        },
      });
    });

    it("should use default collection name when not specified", async () => {
      const template = {
        spec: {
          name: "java-client",
          display_name: "Java Client",
          // No template_collection specified
        },
      } as ScaffoldV1Template;

      sandbox.stub(authnUtils, "getCCloudAuthSession").resolves({
        accessToken: "test-token",
        id: "test-session",
        account: { id: "test", label: "Test" },
        scopes: [],
      });

      const mockBlob = new Blob(["test content"], { type: "application/zip" });
      const applyTemplateStub = sandbox.stub().resolves(mockBlob);
      sandbox.stub(templates, "createScaffoldingApi").returns({
        applyScaffoldV1Template: applyTemplateStub,
        listScaffoldV1Templates: sandbox.stub(),
      } as any);

      const testUri = vscode.Uri.file("/tmp/test-project");
      sandbox.stub(vscode.window, "showOpenDialog").resolves([testUri]);
      sandbox.stub(fileUtils, "fileUriExists").resolves(false);
      sandbox.stub(fsWrappers, "writeFile").resolves();
      sandbox.stub(vscode.window, "showInformationMessage").resolves(undefined);
      // Stub unzip to avoid trying to extract non-zip content
      sandbox.stub(unzipit, "unzip").resolves({ entries: {}, zip: {} } as any);

      await applyTemplate(template, {});

      sinon.assert.calledWithMatch(applyTemplateStub, {
        template_collection_name: "vscode",
      });
    });

    it("should return error when API call fails", async () => {
      const template = {
        spec: {
          name: "java-client",
          display_name: "Java Client",
          template_collection: { id: "vscode" },
        },
      } as ScaffoldV1Template;

      sandbox.stub(authnUtils, "getCCloudAuthSession").resolves({
        accessToken: "test-token",
        id: "test-session",
        account: { id: "test", label: "Test" },
        scopes: [],
      });

      const apiError = new Error("API error");
      sandbox.stub(templates, "createScaffoldingApi").returns({
        applyScaffoldV1Template: sandbox.stub().rejects(apiError),
        listScaffoldV1Templates: sandbox.stub(),
      } as any);

      sandbox.stub(errors, "logError");
      sandbox.stub(notifications, "showErrorNotificationWithButtons");

      const result = await applyTemplate(template, {});

      assert.strictEqual(result.success, false);
      assert.ok(result.message?.includes("Project generation failed"));
    });

    it("should return cancelled message when user cancels folder selection", async () => {
      const template = {
        spec: {
          name: "java-client",
          display_name: "Java Client",
          template_collection: { id: "vscode" },
        },
      } as ScaffoldV1Template;

      sandbox.stub(authnUtils, "getCCloudAuthSession").resolves({
        accessToken: "test-token",
        id: "test-session",
        account: { id: "test", label: "Test" },
        scopes: [],
      });

      const mockBlob = new Blob(["test content"], { type: "application/zip" });
      sandbox.stub(templates, "createScaffoldingApi").returns({
        applyScaffoldV1Template: sandbox.stub().resolves(mockBlob),
        listScaffoldV1Templates: sandbox.stub(),
      } as any);

      // User cancels folder selection
      sandbox.stub(vscode.window, "showOpenDialog").resolves(undefined);

      const result = await applyTemplate(template, {});

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.message, "Project generation cancelled before save.");
    });

    it("should convert all option values to strings", async () => {
      const template = {
        spec: {
          name: "java-client",
          display_name: "Java Client",
          template_collection: { id: "vscode" },
        },
      } as ScaffoldV1Template;

      const manifestOptions = {
        string_option: "value",
        number_option: 123,
        boolean_option: true,
      };

      sandbox.stub(authnUtils, "getCCloudAuthSession").resolves({
        accessToken: "test-token",
        id: "test-session",
        account: { id: "test", label: "Test" },
        scopes: [],
      });

      const mockBlob = new Blob(["test content"], { type: "application/zip" });
      const applyTemplateStub = sandbox.stub().resolves(mockBlob);
      sandbox.stub(templates, "createScaffoldingApi").returns({
        applyScaffoldV1Template: applyTemplateStub,
        listScaffoldV1Templates: sandbox.stub(),
      } as any);

      const testUri = vscode.Uri.file("/tmp/test-project");
      sandbox.stub(vscode.window, "showOpenDialog").resolves([testUri]);
      sandbox.stub(fileUtils, "fileUriExists").resolves(false);
      sandbox.stub(fsWrappers, "writeFile").resolves();
      sandbox.stub(vscode.window, "showInformationMessage").resolves(undefined);
      // Stub unzip to avoid trying to extract non-zip content
      sandbox.stub(unzipit, "unzip").resolves({ entries: {}, zip: {} } as any);

      await applyTemplate(template, manifestOptions);

      sinon.assert.calledWithMatch(applyTemplateStub, {
        ApplyScaffoldV1TemplateRequest: {
          options: {
            string_option: "value",
            number_option: "123",
            boolean_option: "true",
          },
        },
      });
    });
  });
});
