import assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import {
  PresignedUploadUrlArtifactV1PresignedUrl200ResponseApiVersionEnum,
  PresignedUploadUrlArtifactV1PresignedUrl200ResponseKindEnum,
} from "../clients/flinkArtifacts/models/PresignedUploadUrlArtifactV1PresignedUrl200Response";
import * as commands from "./index";
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
      const result = await uploadArtifact.uploadArtifactCommand();

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

      await uploadUDFCommand.uploadArtifactCommand();

      sinon.assert.calledOnce(showInfoStub);
      sinon.assert.calledWithMatch(showInfoStub, sinon.match(/uploaded successfully/));
    });

    it("should show error message if handleUploadToCloudProvider fails", async () => {
      sandbox.stub(uploadArtifact, "promptForArtifactUploadParams").resolves(mockParams);
      sandbox.stub(uploadArtifact, "getPresignedUploadUrl").resolves(mockPresignedUrlResponse);
      sandbox.stub(uploadArtifact, "handleUploadToCloudProvider").rejects(new Error("fail"));
      const showErrorStub = sandbox.stub(vscode.window, "showErrorMessage");

      await uploadUDFCommand.uploadArtifactCommand();

      sinon.assert.calledOnce(showErrorStub);
      sinon.assert.calledWithMatch(showErrorStub, sinon.match(/error/i));
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

      await uploadArtifact.uploadArtifactCommand();

      sinon.assert.calledOnce(handleUploadStub);
      sinon.assert.calledWithExactly(handleUploadStub, mockParams, mockPresignedUrlResponse);

      sinon.assert.calledOnce(createArtifactStub);
      sinon.assert.calledWithExactly(createArtifactStub, mockParams, mockUploadId);
    });
  });

  describe("registerUploadUDFCommand", () => {
    it("should register the uploadUDF command", () => {
      const registerCommandWithLoggingStub = sandbox
        .stub(commands, "registerCommandWithLogging")
        .returns({} as vscode.Disposable);

      uploadUDFCommand.registerUploadUDFCommand();

      sinon.assert.calledOnce(registerCommandWithLoggingStub);
      sinon.assert.calledWithExactly(
        registerCommandWithLoggingStub,
        "confluent.uploadUDF",
        uploadUDFCommand.uploadArtifactCommand,
      );
    });
  });
});
