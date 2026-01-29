import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { getShowErrorNotificationWithButtonsStub } from "../../tests/stubs/notifications";
import { createFlinkArtifact } from "../../tests/unit/testResources/flinkArtifact";

import { TokenManager } from "../auth/oauth2/tokenManager";
import type {
  PresignedUploadUrlArtifactV1PresignedUrl200ResponseApiVersionEnum,
  PresignedUploadUrlArtifactV1PresignedUrl200ResponseKindEnum,
} from "../clients/flinkArtifacts/models/PresignedUploadUrlArtifactV1PresignedUrl200Response";
import type { FlinkArtifact } from "../models/flinkArtifact";
import { FlinkDatabaseResourceContainer } from "../models/flinkDatabaseResourceContainer";
import * as notifications from "../notifications";
import { FlinkDatabaseViewProvider } from "../viewProviders/flinkDatabase";
import { registerFlinkArtifactCommands, uploadArtifactCommand } from "./flinkArtifacts";
import * as commands from "./index";
import * as artifactUploadForm from "./utils/artifactUploadForm";
import * as uploadArtifact from "./utils/uploadArtifactOrUDF";

describe("flinkArtifacts", () => {
  let sandbox: sinon.SinonSandbox;

  const mockParams = {
    environment: "env-123456",
    cloud: "Azure",
    region: "australiaeast",
    artifactName: "test-artifact",
    fileFormat: "jar",
    selectedFile: { fsPath: "/path/to/file.jar" } as vscode.Uri,
  };
  const mockPresignedUrlResponse = {
    upload_id: "12345",
    url: "https://example.com/upload",
    fields: {},
    api_version:
      "v1" as unknown as PresignedUploadUrlArtifactV1PresignedUrl200ResponseApiVersionEnum,
    kind: "kind" as unknown as PresignedUploadUrlArtifactV1PresignedUrl200ResponseKindEnum,
  };

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("registerFlinkArtifactCommands", () => {
    it("should register the uploadArtifact command", () => {
      const registerCommandWithLoggingStub = sandbox
        .stub(commands, "registerCommandWithLogging")
        .returns({} as vscode.Disposable);

      registerFlinkArtifactCommands();

      sinon.assert.calledWithExactly(
        registerCommandWithLoggingStub,
        "confluent.uploadArtifact",
        uploadArtifactCommand,
      );
    });
  });

  describe("uploadArtifactCommand", () => {
    const mockCreateResponse = {
      display_name: "test-artifact",
      id: "artifact-123",
      environment: "env-123456",
      region: "australiaeast",
      cloud: "Azure",
    };

    let showErrorStub: sinon.SinonStub;
    let showInfoStub: sinon.SinonStub;
    let stubbedDatabaseViewProvider: sinon.SinonStubbedInstance<FlinkDatabaseViewProvider>;
    let stubbedArtifactsContainer: sinon.SinonStubbedInstance<
      FlinkDatabaseResourceContainer<FlinkArtifact>
    >;

    beforeEach(() => {
      sandbox.stub(vscode.window, "showOpenDialog").resolves([mockParams.selectedFile]);
      showErrorStub = getShowErrorNotificationWithButtonsStub(sandbox);
      showInfoStub = sandbox.stub(notifications, "showInfoNotificationWithButtons");

      stubbedDatabaseViewProvider = sandbox.createStubInstance(FlinkDatabaseViewProvider);
      sandbox.stub(FlinkDatabaseViewProvider, "getInstance").returns(stubbedDatabaseViewProvider);
      stubbedArtifactsContainer = sandbox.createStubInstance(
        FlinkDatabaseResourceContainer<FlinkArtifact>,
      );
      // no preloaded artifacts in the view's Artifacts container by default
      stubbedArtifactsContainer.gatherResources.resolves([]);
      stubbedDatabaseViewProvider.artifactsContainer = stubbedArtifactsContainer;
    });

    it("should fail if there is no params", async () => {
      sandbox.stub(artifactUploadForm, "artifactUploadQuickPickForm").resolves(undefined);
      const result = await uploadArtifactCommand();

      assert.strictEqual(result, undefined);
    });

    it("should show information message if uploadArtifactToCCloud is called successfully", async () => {
      sandbox.stub(artifactUploadForm, "artifactUploadQuickPickForm").resolves(mockParams);
      sandbox.stub(uploadArtifact, "getPresignedUploadUrl").resolves(mockPresignedUrlResponse);
      sandbox.stub(uploadArtifact, "handleUploadToCloudProvider").resolves();
      sandbox.stub(uploadArtifact, "uploadArtifactToCCloud").resolves(mockCreateResponse);

      await uploadArtifactCommand();

      sinon.assert.calledOnce(showInfoStub);
      sinon.assert.calledWithMatch(showInfoStub, sinon.match(/uploaded successfully/));
    });

    it("should show error notification with custom error message when Error has message property", async () => {
      sandbox.stub(artifactUploadForm, "artifactUploadQuickPickForm").resolves(mockParams);
      sandbox.stub(uploadArtifact, "getPresignedUploadUrl").resolves(mockPresignedUrlResponse);
      sandbox.stub(uploadArtifact, "handleUploadToCloudProvider").resolves();

      const customErrorMessage = "Custom error message from Error instance";
      const error = new Error(customErrorMessage);

      sandbox.stub(uploadArtifact, "uploadArtifactToCCloud").rejects(error);

      await uploadArtifactCommand();

      sinon.assert.calledOnce(showErrorStub);
      sinon.assert.calledWithMatch(showErrorStub, customErrorMessage);
    });

    it("should send the create artifact request to Confluent Cloud", async () => {
      const mockUploadId = "12345";

      sandbox.stub(artifactUploadForm, "artifactUploadQuickPickForm").resolves(mockParams);
      sandbox.stub(uploadArtifact, "getPresignedUploadUrl").resolves(mockPresignedUrlResponse);
      const handleUploadStub = sandbox
        .stub(uploadArtifact, "handleUploadToCloudProvider")
        .resolves();
      const createArtifactStub = sandbox
        .stub(uploadArtifact, "uploadArtifactToCCloud")
        .resolves(mockCreateResponse);
      sandbox.stub(vscode.window, "showInformationMessage");

      await uploadArtifactCommand();

      sinon.assert.calledOnce(handleUploadStub);
      sinon.assert.calledWithExactly(handleUploadStub, mockParams, mockPresignedUrlResponse);

      sinon.assert.calledOnce(createArtifactStub);
      sinon.assert.calledWithExactly(createArtifactStub, mockParams, mockUploadId);
    });

    it("should include the 'View Artifact' notification button when the uploaded artifact is in the Flink Database view", async () => {
      sandbox.stub(artifactUploadForm, "artifactUploadQuickPickForm").resolves(mockParams);
      sandbox.stub(uploadArtifact, "getPresignedUploadUrl").resolves(mockPresignedUrlResponse);
      sandbox.stub(uploadArtifact, "handleUploadToCloudProvider").resolves();
      sandbox.stub(uploadArtifact, "uploadArtifactToCCloud").resolves(mockCreateResponse);
      const testArtifact = createFlinkArtifact({
        id: mockCreateResponse.id,
        name: "test-artifact",
      });
      stubbedArtifactsContainer.gatherResources.resolves([testArtifact]);

      await uploadArtifactCommand();

      sinon.assert.calledOnce(showInfoStub);
      const message = showInfoStub.firstCall.args[0] as string;
      const buttons = showInfoStub.firstCall.args[1] as Record<string, () => void>;
      assert.ok(message.includes("uploaded successfully"), "Should show success message");
      assert.ok(buttons["View Artifact"]);
    });

    it("should not include the 'View Artifact' notification button if the uploaded artifact is not in the Flink Database view", async () => {
      sandbox.stub(artifactUploadForm, "artifactUploadQuickPickForm").resolves(mockParams);
      sandbox.stub(uploadArtifact, "getPresignedUploadUrl").resolves(mockPresignedUrlResponse);
      sandbox.stub(uploadArtifact, "handleUploadToCloudProvider").resolves();
      sandbox.stub(uploadArtifact, "uploadArtifactToCCloud").resolves(mockCreateResponse);
      // simulate timeout loading artifacts, or some other database (env/provider/region) is focused
      stubbedArtifactsContainer.gatherResources.resolves([]);

      await uploadArtifactCommand();

      sinon.assert.calledOnce(showInfoStub);
      const message = showInfoStub.firstCall.args[0] as string;
      const buttons = showInfoStub.firstCall.args[1] as Record<string, () => void>;
      assert.ok(message.includes("uploaded successfully"), "Should show success message");
      assert.strictEqual(buttons["View Artifact"], undefined);
    });
  });

  describe("updateArtifactCommand", () => {
    let showErrorStub: sinon.SinonStub;
    let showInfoStub: sinon.SinonStub;
    let tokenStub: sinon.SinonStub;
    let fetchStub: sinon.SinonStub;
    let getArtifactPatchParamsStub: sinon.SinonStub;

    beforeEach(() => {
      showErrorStub = getShowErrorNotificationWithButtonsStub(sandbox);
      showInfoStub = sandbox.stub(notifications, "showInfoNotificationWithButtons");

      // Stub token manager
      tokenStub = sandbox.stub(TokenManager, "getInstance");
      tokenStub.returns({
        getDataPlaneToken: sandbox.stub().resolves("test-token"),
      });
    });

    afterEach(() => {
      fetchStub?.restore();
    });

    it("should show error notification if no artifact is selected", async () => {
      const { updateArtifactCommand } = await import("./flinkArtifacts");

      await updateArtifactCommand(undefined);

      sinon.assert.calledOnce(showErrorStub);
      sinon.assert.calledWithMatch(showErrorStub, /No Flink artifact selected/);
    });

    it("should exit early if user cancels without making changes", async () => {
      const { updateArtifactCommand } = await import("./flinkArtifacts");

      getArtifactPatchParamsStub = sandbox
        .stub(uploadArtifact, "getArtifactPatchParams")
        .resolves(undefined);

      await updateArtifactCommand(createFlinkArtifact());

      sinon.assert.calledOnce(getArtifactPatchParamsStub);
      sinon.assert.notCalled(showInfoStub);
      sinon.assert.notCalled(showErrorStub);
    });

    it("should successfully update artifact when user provides changes", async () => {
      const { updateArtifactCommand } = await import("./flinkArtifacts");

      getArtifactPatchParamsStub = sandbox
        .stub(uploadArtifact, "getArtifactPatchParams")
        .resolves({ description: "new description", documentation_link: "https://example.com" });

      fetchStub = sandbox.stub(global, "fetch").resolves({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Map([["content-type", "application/json"]]) as unknown as Headers,
        json: async () => ({ id: "artifact-123", display_name: "Test Artifact" }),
      } as Response);

      await updateArtifactCommand(createFlinkArtifact());

      sinon.assert.calledOnce(showInfoStub);
      sinon.assert.calledWithMatch(showInfoStub, /updated successfully/);
    });

    it("should show error notification when API call fails", async () => {
      const { updateArtifactCommand } = await import("./flinkArtifacts");

      getArtifactPatchParamsStub = sandbox
        .stub(uploadArtifact, "getArtifactPatchParams")
        .resolves({ description: "new description", documentation_link: undefined });

      fetchStub = sandbox.stub(global, "fetch").resolves({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        headers: new Map([["content-type", "application/json"]]) as unknown as Headers,
        json: async () => ({ error: "Something went wrong" }),
      } as Response);

      await updateArtifactCommand(createFlinkArtifact());

      sinon.assert.calledOnce(showErrorStub);
      sinon.assert.calledWithMatch(showErrorStub, /Failed to update artifact/);
    });
  });
});
