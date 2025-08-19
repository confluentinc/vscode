import assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import {
  PresignedUploadUrlArtifactV1PresignedUrl200ResponseApiVersionEnum,
  PresignedUploadUrlArtifactV1PresignedUrl200ResponseKindEnum,
} from "../clients/flinkArtifacts/models/PresignedUploadUrlArtifactV1PresignedUrl200Response";
import * as commands from "./index";
import * as uploadUDFCommand from "./uploadUDF";
import * as uploadUDF from "./utils/uploadUDF";

describe("uploadUDF Command", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("uploadUDFCommand", () => {
    it("should fail if there is no params", async () => {
      sandbox.stub(uploadUDF, "promptForUDFUploadParams").resolves(undefined);
      const result = await uploadUDFCommand.uploadUDFCommand();

      assert.strictEqual(result, undefined);
    });
    it("should show information message if handeluUploadFile is called successfully", async () => {
      sandbox.stub(uploadUDF, "handleUploadToCloudProvider").resolves();

      const showInfoStub = sandbox.stub(vscode.window, "showInformationMessage");

      await uploadUDFCommand.uploadUDFCommand();

      sinon.assert.calledOnce(showInfoStub);
    });
    it("should show error message if handleUploadToCloudProvider fails", async () => {
      const showErrorStub = sandbox.stub(vscode.window, "showErrorMessage");

      await uploadUDFCommand.uploadUDFCommand();

      sinon.assert.calledOnce(showErrorStub);
    });

    it("should send the create artifact request to Confluent Cloud", async () => {
      const mockUploadId = "12345";
      const mockParams = {
        environment: "env-123456",
        cloud: "Azure",
        region: "australiaeast",
        artifactName: "test-artifact",
        fileFormat: "jar",
        selectedFile: { fsPath: "/path/to/file.jar" } as vscode.Uri,
      };
      const mockPresignedUrlResponse = {
        upload_id: mockUploadId,
        url: "https://example.com/upload",
        fields: {},
        api_version:
          "v1" as unknown as PresignedUploadUrlArtifactV1PresignedUrl200ResponseApiVersionEnum,
        kind: "kind" as unknown as PresignedUploadUrlArtifactV1PresignedUrl200ResponseKindEnum,
      };

      sandbox.stub(uploadUDF, "promptForUDFUploadParams").resolves(mockParams);
      sandbox.stub(uploadUDF, "getPresignedUploadUrl").resolves(mockPresignedUrlResponse);
      const handleUploadStub = sandbox.stub(uploadUDF, "handleUploadToCloudProvider").resolves();
      const createArtifactStub = sandbox.stub(uploadUDF, "uploadArtifactToCCloud").resolves();

      await uploadUDFCommand.uploadUDFCommand();

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
        uploadUDFCommand.uploadUDFCommand,
      );
    });
  });
});
