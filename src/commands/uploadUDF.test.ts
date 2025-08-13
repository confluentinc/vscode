import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import type { PresignedUploadUrlArtifactV1PresignedUrlRequest } from "../clients/flinkArtifacts";
import * as errors from "../errors";
import * as errorsModule from "../errors";
import * as notifications from "../notifications";
import * as sidecarModule from "../sidecar";
import * as ccloudAuth from "../sidecar/connections/ccloud";
import { uploadUDFCommand } from "./uploadUDF";
import * as uploadUDFUtils from "./utils/uploadUDF";
import { getPresignedUploadUrl } from "./utils/uploadUDF";

describe("getPresignedUploadUrl", () => {
  let sandbox: sinon.SinonSandbox;
  let getSidecarStub: sinon.SinonStub;
  let logErrorStub: sinon.SinonStub;
  let artifactsClientStub: sinon.SinonStubbedInstance<any>;
  let sidecarHandleStub: sinon.SinonStubbedInstance<any>;

  const request: PresignedUploadUrlArtifactV1PresignedUrlRequest = {
    environment: "env-1",
    cloud: "aws",
    region: "us-west-2",
  } as PresignedUploadUrlArtifactV1PresignedUrlRequest;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    artifactsClientStub = {
      presignedUploadUrlArtifactV1PresignedUrl: sandbox.stub(),
    };
    sidecarHandleStub = {
      getFlinkPresignedUrlsApi: sandbox.stub().returns(artifactsClientStub),
    };
    getSidecarStub = sandbox.stub().resolves(sidecarHandleStub);
    sandbox.stub(sidecarModule, "getSidecar").callsFake(getSidecarStub);
    logErrorStub = sandbox.stub(errorsModule, "logError");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should return the presigned URL response when the API call succeeds", async () => {
    const fakeResponse = {
      url: "https://test-flink-artifacts-env1-us-west-2.s3.dualstack.us-west-2.amazonaws.com/",
      expires: 1234567890,
    };
    artifactsClientStub.presignedUploadUrlArtifactV1PresignedUrl.resolves(fakeResponse);

    const result = await getPresignedUploadUrl(request);

    sinon.assert.calledOnce(getSidecarStub);

    const callArg = sidecarHandleStub.getFlinkPresignedUrlsApi.getCall(0).args[0];
    assert.strictEqual(callArg.environmentId, request.environment);
    assert.strictEqual(callArg.provider, request.cloud);
    assert.strictEqual(callArg.region, request.region);

    assert.strictEqual(result, fakeResponse);
  });

  it("should return undefined if the API call throws", async () => {
    const error = new Error("API failure");
    artifactsClientStub.presignedUploadUrlArtifactV1PresignedUrl.rejects(error);

    const result = await getPresignedUploadUrl(request);

    assert.strictEqual(result, undefined);
  });

  it("should return undefined if getSidecar throws", async () => {
    const error = new Error("Sidecar connection failed");
    getSidecarStub.rejects(error);

    const result = await getPresignedUploadUrl(request);

    assert.strictEqual(result, undefined);
  });

  it("should return undefined if getFlinkPresignedUrlsApi throws", async () => {
    const error = new Error("Client creation failed");
    sidecarHandleStub.getFlinkPresignedUrlsApi.throws(error);

    const result = await getPresignedUploadUrl(request);

    assert.strictEqual(result, undefined);
  });

  it("should handle Azure cloud provider correctly", async () => {
    const azureRequest: PresignedUploadUrlArtifactV1PresignedUrlRequest = {
      environment: "env-2",
      cloud: "Azure",
      region: "eastus",
    } as PresignedUploadUrlArtifactV1PresignedUrlRequest;

    const fakeResponse = {
      url: "https://test-storage.blob.core.windows.net/",
      expires: 1234567890,
    };
    artifactsClientStub.presignedUploadUrlArtifactV1PresignedUrl.resolves(fakeResponse);

    const result = await getPresignedUploadUrl(azureRequest);

    const callArg = sidecarHandleStub.getFlinkPresignedUrlsApi.getCall(0).args[0];
    assert.strictEqual(callArg.environmentId, "env-2");
    assert.strictEqual(callArg.provider, "Azure");
    assert.strictEqual(callArg.region, "eastus");
    assert.strictEqual(result, fakeResponse);
  });

  it("should pass the complete request object to the API call", async () => {
    const completeRequest: PresignedUploadUrlArtifactV1PresignedUrlRequest = {
      environment: "env-test",
      cloud: "AWS",
      region: "eu-west-1",
      id: "test-artifact-id",
      content_format: "jar",
    } as PresignedUploadUrlArtifactV1PresignedUrlRequest;

    const fakeResponse = { url: "https://test.com", expires: 123 };
    artifactsClientStub.presignedUploadUrlArtifactV1PresignedUrl.resolves(fakeResponse);

    await getPresignedUploadUrl(completeRequest);

    sinon.assert.calledOnceWithExactly(
      artifactsClientStub.presignedUploadUrlArtifactV1PresignedUrl,
      { PresignedUploadUrlArtifactV1PresignedUrlRequest: completeRequest },
    );
  });

  it("should return undefined response when API returns undefined", async () => {
    artifactsClientStub.presignedUploadUrlArtifactV1PresignedUrl.resolves(undefined);

    const result = await getPresignedUploadUrl(request);

    assert.strictEqual(result, undefined);
    sinon.assert.notCalled(logErrorStub);
  });

  it("should return null response when API returns null", async () => {
    artifactsClientStub.presignedUploadUrlArtifactV1PresignedUrl.resolves(null);

    const result = await getPresignedUploadUrl(request);

    assert.strictEqual(result, null);
    sinon.assert.notCalled(logErrorStub);
  });
});

describe("uploadUDF", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("uploadUDFCommand", () => {
    let hasCCloudAuthSessionStub: sinon.SinonStub;
    let promptForUDFUploadParamsStub: sinon.SinonStub;
    let handlePresignedUrlRequestStub: sinon.SinonStub;
    let handleUploadFileStub: sinon.SinonStub;
    let showErrorNotificationStub: sinon.SinonStub;
    let showInformationMessageStub: sinon.SinonStub;
    let logErrorStub: sinon.SinonStub;

    beforeEach(() => {
      hasCCloudAuthSessionStub = sandbox.stub(ccloudAuth, "hasCCloudAuthSession").returns(true);
      promptForUDFUploadParamsStub = sandbox.stub(uploadUDFUtils, "promptForUDFUploadParams");
      handlePresignedUrlRequestStub = sandbox.stub(uploadUDFUtils, "handlePresignedUrlRequest");
      handleUploadFileStub = sandbox.stub(uploadUDFUtils, "handleUploadFile");
      showErrorNotificationStub = sandbox.stub(notifications, "showErrorNotificationWithButtons");
      showInformationMessageStub = sandbox.stub(vscode.window, "showInformationMessage");
      logErrorStub = sandbox.stub(errors, "logError");
    });

    it("should return early if no CCloud auth session", async () => {
      hasCCloudAuthSessionStub.returns(false);

      await uploadUDFCommand();

      sinon.assert.notCalled(promptForUDFUploadParamsStub);
      sinon.assert.notCalled(handlePresignedUrlRequestStub);
      sinon.assert.notCalled(handleUploadFileStub);
    });

    it("should return early if user cancels parameter prompt", async () => {
      promptForUDFUploadParamsStub.resolves(undefined);

      await uploadUDFCommand();

      sinon.assert.calledOnce(promptForUDFUploadParamsStub);
      sinon.assert.notCalled(handlePresignedUrlRequestStub);
      sinon.assert.notCalled(handleUploadFileStub);
    });

    it("should show error notification and return if presigned URL request fails", async () => {
      const mockParams = {
        environment: "env-123",
        cloud: "AWS" as const,
        region: "us-west-2",
        artifactName: "test-artifact",
        fileFormat: "jar" as const,
        selectedFile: vscode.Uri.file("/path/to/test.jar"),
      };

      promptForUDFUploadParamsStub.resolves(mockParams);
      handlePresignedUrlRequestStub.resolves(undefined);

      await uploadUDFCommand();

      const expectedRequest: PresignedUploadUrlArtifactV1PresignedUrlRequest = {
        environment: "env-123",
        cloud: "AWS",
        region: "us-west-2",
        id: "test-artifact",
        content_format: "jar",
      };

      sinon.assert.calledOnceWithExactly(handlePresignedUrlRequestStub, expectedRequest);
      sinon.assert.calledOnceWithExactly(
        showErrorNotificationStub,
        "Failed to get presigned upload URL. See logs for details.",
      );
      sinon.assert.notCalled(handleUploadFileStub);
      sinon.assert.notCalled(showInformationMessageStub);
    });

    it("should successfully upload file and show success message when all operations succeed", async () => {
      const mockParams = {
        environment: "env-456",
        cloud: "Azure" as const,
        region: "eastus",
        artifactName: "my-udf",
        fileFormat: "jar" as const,
        selectedFile: vscode.Uri.file("/path/to/my-udf.jar"),
      };
      const mockUploadUrl = "https://example.com/upload-url";

      promptForUDFUploadParamsStub.resolves(mockParams);
      handlePresignedUrlRequestStub.resolves(mockUploadUrl);
      handleUploadFileStub.resolves();

      await uploadUDFCommand();

      const expectedRequest: PresignedUploadUrlArtifactV1PresignedUrlRequest = {
        environment: "env-456",
        cloud: "Azure",
        region: "eastus",
        id: "my-udf",
        content_format: "jar",
      };

      sinon.assert.calledOnceWithExactly(handlePresignedUrlRequestStub, expectedRequest);
      sinon.assert.calledOnceWithExactly(handleUploadFileStub, mockParams, mockUploadUrl);
      sinon.assert.calledOnceWithExactly(
        showInformationMessageStub,
        'UDF artifact "my-udf" uploaded successfully!',
      );
      sinon.assert.notCalled(showErrorNotificationStub);
      sinon.assert.notCalled(logErrorStub);
    });

    it("should handle errors during upload process", async () => {
      const mockParams = {
        environment: "env-789",
        cloud: "Azure" as const,
        region: "us-central1",
        artifactName: "failing-udf",
        fileFormat: "jar" as const,
        selectedFile: vscode.Uri.file("/path/to/failing.jar"),
      };
      const mockUploadUrl = "https://example.com/upload-url";
      const uploadError = new Error("Upload failed");

      promptForUDFUploadParamsStub.resolves(mockParams);
      handlePresignedUrlRequestStub.resolves(mockUploadUrl);
      handleUploadFileStub.rejects(uploadError);

      await uploadUDFCommand();

      sinon.assert.calledOnceWithExactly(handleUploadFileStub, mockParams, mockUploadUrl);
      sinon.assert.calledOnceWithExactly(
        logErrorStub,
        uploadError,
        "Failed to execute Upload UDF command",
      );
      sinon.assert.calledOnceWithExactly(
        showErrorNotificationStub,
        "An error occurred while uploading UDF. See logs for details.",
      );
      sinon.assert.notCalled(showInformationMessageStub);
    });

    it("should handle errors during presigned URL request", async () => {
      const mockParams = {
        environment: "env-error",
        cloud: "AWS" as const,
        region: "us-west-1",
        artifactName: "error-udf",
        fileFormat: "jar" as const,
        selectedFile: vscode.Uri.file("/path/to/error.jar"),
      };
      const requestError = new Error("Presigned URL request failed");

      promptForUDFUploadParamsStub.resolves(mockParams);
      handlePresignedUrlRequestStub.rejects(requestError);

      await uploadUDFCommand();

      sinon.assert.calledOnceWithExactly(
        logErrorStub,
        requestError,
        "Failed to execute Upload UDF command",
      );
      sinon.assert.calledOnceWithExactly(
        showErrorNotificationStub,
        "An error occurred while uploading UDF. See logs for details.",
      );
      sinon.assert.notCalled(handleUploadFileStub);
      sinon.assert.notCalled(showInformationMessageStub);
    });
  });
});
