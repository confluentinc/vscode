import assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { getShowErrorNotificationWithButtonsStub } from "../../tests/stubs/notifications";
import { createResponseError } from "../../tests/unit/testUtils";
import {
  PresignedUploadUrlArtifactV1PresignedUrl200ResponseApiVersionEnum,
  PresignedUploadUrlArtifactV1PresignedUrl200ResponseKindEnum,
} from "../clients/flinkArtifacts/models/PresignedUploadUrlArtifactV1PresignedUrl200Response";
import * as commands from "./index";
import { registerUploadArtifactCommand, uploadArtifactCommand } from "./uploadArtifact";
import * as uploadArtifact from "./utils/uploadArtifact";

describe("uploadArtifact Command", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("uploadArtifactCommand", () => {
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
    it("should fail if there is no params", async () => {
      sandbox.stub(uploadArtifact, "promptForArtifactUploadParams").resolves(undefined);
      const result = await uploadArtifactCommand();

      assert.strictEqual(result, undefined);
    });

    it("should show information message if uploadArtifactToCCloud is called successfully", async () => {
      const mockCreateResponse = {
        display_name: "test-artifact",
        cloud: "Azure",
        region: "australiaeast",
        environment: " env-123456",
      };

      sandbox.stub(uploadArtifact, "promptForArtifactUploadParams").resolves(mockParams);
      sandbox.stub(uploadArtifact, "getPresignedUploadUrl").resolves(mockPresignedUrlResponse);
      sandbox.stub(uploadArtifact, "handleUploadToCloudProvider").resolves();
      sandbox.stub(uploadArtifact, "uploadArtifactToCCloud").resolves(mockCreateResponse);

      const showInfoStub = sandbox.stub(vscode.window, "showInformationMessage");

      await uploadArtifactCommand();

      sinon.assert.calledOnce(showInfoStub);
      sinon.assert.calledWithMatch(showInfoStub, sinon.match(/uploaded successfully/));
    });

    it("should show error message if handleUploadToCloudProvider fails", async () => {
      sandbox.stub(uploadArtifact, "promptForArtifactUploadParams").resolves(mockParams);
      sandbox.stub(uploadArtifact, "getPresignedUploadUrl").resolves(mockPresignedUrlResponse);
      sandbox
        .stub(uploadArtifact, "handleUploadToCloudProvider")
        .rejects(createResponseError(500, "Internal Server Error", "Server error"));
      const showErrorStub = getShowErrorNotificationWithButtonsStub(sandbox);
      sandbox.stub(vscode.window, "withProgress").resolves();
      await uploadArtifactCommand();

      sinon.assert.calledOnce(showErrorStub);
      sinon.assert.calledWithMatch(showErrorStub, sinon.match(/Failed to upload artifact/));
    });

    it("should show error notification for non-ResponseError thrown", async () => {
      sandbox.stub(uploadArtifact, "promptForArtifactUploadParams").resolves(mockParams);
      sandbox.stub(uploadArtifact, "getPresignedUploadUrl").resolves(mockPresignedUrlResponse);
      sandbox.stub(uploadArtifact, "handleUploadToCloudProvider").resolves();
      sandbox
        .stub(uploadArtifact, "uploadArtifactToCCloud")
        .rejects(new Error("Some generic error"));

      const showErrorStub = getShowErrorNotificationWithButtonsStub(sandbox);
      sandbox.stub(vscode.window, "showInformationMessage");

      await uploadArtifactCommand();

      sinon.assert.calledOnce(showErrorStub);
      sinon.assert.calledWithMatch(showErrorStub, sinon.match(/Failed to upload artifact/));
    });

    it("should show error notification if uploadUrl.upload_id is missing", async () => {
      const params = { ...mockParams };
      const uploadUrlMissingId = { ...mockPresignedUrlResponse, upload_id: undefined };

      sandbox.stub(uploadArtifact, "promptForArtifactUploadParams").resolves(params);
      sandbox.stub(uploadArtifact, "getPresignedUploadUrl").resolves(uploadUrlMissingId);
      sandbox.stub(uploadArtifact, "handleUploadToCloudProvider").resolves();

      const showErrorStub = getShowErrorNotificationWithButtonsStub(sandbox);

      await uploadArtifactCommand();

      sinon.assert.calledOnce(showErrorStub);
      sinon.assert.calledWithMatch(
        showErrorStub,
        sinon.match(/Failed to upload artifact. See logs for details/),
      );
    });

    it("should show error notification with error message from JSON-formatted message if present", async () => {
      const params = { ...mockParams };
      const uploadUrl = { ...mockPresignedUrlResponse };

      sandbox.stub(uploadArtifact, "promptForArtifactUploadParams").resolves(params);
      sandbox.stub(uploadArtifact, "getPresignedUploadUrl").resolves(uploadUrl);
      sandbox.stub(uploadArtifact, "handleUploadToCloudProvider").resolves();

      const errorMessage = "Artifact already exists";
      const respJson = { error: { message: errorMessage } };

      // Pass stringified JSON as the body
      const responseError = createResponseError(409, "Conflict", JSON.stringify(respJson));

      sandbox.stub(uploadArtifact, "uploadArtifactToCCloud").rejects(responseError);

      const showErrorStub = getShowErrorNotificationWithButtonsStub(sandbox);

      await uploadArtifactCommand();

      sinon.assert.calledOnce(showErrorStub);
      sinon.assert.calledWithMatch(showErrorStub, errorMessage);
    });

    it("should send the create artifact request to Confluent Cloud", async () => {
      const mockUploadId = "12345";
      const mockCreateResponse = {
        display_name: "test-artifact",
        id: "artifact-123",
        environment: "env-123456",
        region: "australiaeast",
        cloud: "Azure",
      };

      sandbox.stub(uploadArtifact, "promptForArtifactUploadParams").resolves(mockParams);
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
  });

  describe("registerUploadArtifactCommand", () => {
    it("should register the uploadArtifact command", () => {
      const registerCommandWithLoggingStub = sandbox
        .stub(commands, "registerCommandWithLogging")
        .returns({} as vscode.Disposable);

      registerUploadArtifactCommand();

      sinon.assert.calledOnce(registerCommandWithLoggingStub);
      sinon.assert.calledWithExactly(
        registerCommandWithLoggingStub,
        "confluent.uploadArtifact",
        uploadArtifactCommand,
      );
    });
  });
});
