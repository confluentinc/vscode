import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import path from "path";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { Response } from "node-fetch";

import { getShowErrorNotificationWithButtonsStub } from "../../../tests/stubs/notifications";
import { getSidecarStub } from "../../../tests/stubs/sidecar";
import { TEST_CCLOUD_ENVIRONMENT } from "../../../tests/unit/testResources";
import { createResponseError } from "../../../tests/unit/testUtils";
import {
  FlinkArtifactsArtifactV1Api,
  PresignedUploadUrlArtifactV1PresignedUrl200Response,
  PresignedUploadUrlArtifactV1PresignedUrl200ResponseApiVersionEnum,
  PresignedUploadUrlArtifactV1PresignedUrl200ResponseKindEnum,
} from "../../clients/flinkArtifacts";
import { PresignedUrlsArtifactV1Api } from "../../clients/flinkArtifacts/apis/PresignedUrlsArtifactV1Api";
import { PresignedUploadUrlArtifactV1PresignedUrlRequest } from "../../clients/flinkArtifacts/models/PresignedUploadUrlArtifactV1PresignedUrlRequest";
import { FcpmV2RegionListDataInner } from "../../clients/flinkComputePool/models/FcpmV2RegionListDataInner";
import { CloudProvider } from "../../models/resource";
import * as notifications from "../../notifications";
import * as cloudProviderRegions from "../../quickpicks/cloudProviderRegions";
import * as environments from "../../quickpicks/environments";
import * as sidecar from "../../sidecar";
import * as fsWrappers from "../../utils/fsWrappers";
import * as uploadArtifactModule from "./uploadArtifact";
import {
  buildCreateArtifactRequest,
  getPresignedUploadUrl,
  handleUploadToCloudProvider,
  prepareUploadFileFromUri,
  PRESIGNED_URL_LOCATION,
  promptForArtifactUploadParams,
  uploadArtifactToCCloud,
} from "./uploadArtifact";
import * as uploadToProvider from "./uploadToProvider";

describe("uploadArtifact", () => {
  let sandbox: sinon.SinonSandbox;
  let tempJarPath: string;
  let tempJarUri: vscode.Uri;
  const tempDir = os.tmpdir();

  const mockAzureParams = {
    environment: "env-123456",
    cloud: "Azure",
    region: "australiaeast",
    artifactName: "test-artifact",
    fileFormat: "jar",
    selectedFile: undefined as unknown as vscode.Uri,
  };

  const mockAwsParams = {
    environment: "env-123456",
    cloud: "AWS",
    region: "us-east-1",
    artifactName: "test-artifact",
    fileFormat: "jar",
    selectedFile: undefined as unknown as vscode.Uri,
  };

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    tempJarPath = path.join(tempDir, `test-artifact-${Date.now()}.jar`);
    fs.writeFileSync(tempJarPath, "dummy jar content");
    tempJarUri = vscode.Uri.file(tempJarPath);
    mockAzureParams.selectedFile = tempJarUri;
    mockAwsParams.selectedFile = tempJarUri;
  });

  afterEach(() => {
    sandbox.restore();
    // Clean up temp files created for tests
    if (tempJarPath && fs.existsSync(tempJarPath)) {
      try {
        fs.unlinkSync(tempJarPath);
      } catch {
        // ignore errors on cleanup
      }
    }
  });

  describe("prepareUploadFileFromUri", () => {
    it("should prepare the file for upload", async () => {
      const mockBuffer = Buffer.from("test file content");
      const readFileBufferStub = sandbox.stub(fsWrappers, "readFileBuffer").resolves(mockBuffer);
      const mockUri = { fsPath: "/path/to/file.jar" } as vscode.Uri;
      const result = await prepareUploadFileFromUri(mockUri);

      sinon.assert.calledOnceWithExactly(readFileBufferStub, mockUri);

      assert.deepStrictEqual(result, {
        blob: new Blob([mockBuffer], { type: "application/java-archive" }),
        contentType: "application/java-archive",
      });
    });

    it("should throw an error if the file does not exist", async () => {
      const mockUri = { fsPath: "/path/to/nonexistent.jar" } as vscode.Uri;
      await assert.rejects(() => prepareUploadFileFromUri(mockUri), Error);
    });
  });

  describe("getPresignedUploadUrl", () => {
    it("should return a presigned upload URL", async () => {
      const mockSidecarHandle = sandbox.createStubInstance(sidecar.SidecarHandle);
      const mockResponse = {
        upload_url: "https://example.com/presigned-url",
        api_version: PresignedUploadUrlArtifactV1PresignedUrl200ResponseApiVersionEnum.ArtifactV1,
        kind: PresignedUploadUrlArtifactV1PresignedUrl200ResponseKindEnum.PresignedUrl,
      };

      const mockPresignedClient = sandbox.createStubInstance(PresignedUrlsArtifactV1Api);
      mockPresignedClient.presignedUploadUrlArtifactV1PresignedUrl.resolves(mockResponse);

      mockSidecarHandle.getFlinkPresignedUrlsApi.returns(mockPresignedClient);

      sandbox.stub(sidecar, "getSidecar").resolves(mockSidecarHandle);

      const mockPresignedUploadUrlRequest: PresignedUploadUrlArtifactV1PresignedUrlRequest = {
        content_format: "application/java-archive",
        cloud: "azure",
        region: "australiaeast",
        environment: "env-123456",
      };

      const response = await getPresignedUploadUrl(mockPresignedUploadUrlRequest);
      assert.deepStrictEqual(response, {
        api_version: "artifact/v1",
        kind: "PresignedUrl",
        upload_url: "https://example.com/presigned-url",
      });
    });
  });

  describe("promptForArtifactUploadParams", () => {
    let flinkCcloudEnvironmentQuickPickStub: sinon.SinonStub;
    let cloudProviderRegionQuickPickStub: sinon.SinonStub;
    const fakeCloudProviderRegion: FcpmV2RegionListDataInner = {
      id: "australiaeast",
      cloud: "temp", //Change in below tests
      display_name: "Australia East",
      region_name: "australiaeast",
      metadata: {} as any,
      http_endpoint: "",
    };
    const mockEnvironment = TEST_CCLOUD_ENVIRONMENT;
    const mockFileName = "mock-file";
    const mockFileUri = vscode.Uri.file(`/path/to/${mockFileName}.jar`);
    beforeEach(() => {
      flinkCcloudEnvironmentQuickPickStub = sandbox.stub(
        environments,
        "flinkCcloudEnvironmentQuickPick",
      );
      cloudProviderRegionQuickPickStub = sandbox.stub(
        cloudProviderRegions,
        "cloudProviderRegionQuickPick",
      );
    });
    it("should return undefined if environment is not selected", async () => {
      const result = await promptForArtifactUploadParams();
      assert.strictEqual(result, undefined);
    });

    it("should return undefined if region is not selected", async () => {
      flinkCcloudEnvironmentQuickPickStub.resolves(TEST_CCLOUD_ENVIRONMENT);
      const result = await promptForArtifactUploadParams();
      assert.strictEqual(result, undefined);
    });

    it("should show error and return undefined for GCP cloud provider", async () => {
      flinkCcloudEnvironmentQuickPickStub.resolves(TEST_CCLOUD_ENVIRONMENT);

      const mockGCPRegion = {
        id: "us-central1",
        provider: "GCP" as CloudProvider,
        displayName: "US Central 1",
        regionName: "us-central1",
        region: "us-central1",
      };

      cloudProviderRegionQuickPickStub.resolves(mockGCPRegion);

      const errorNotificationStub = sandbox.stub(vscode.window, "showErrorMessage").resolves();

      const result = await promptForArtifactUploadParams();

      sinon.assert.calledWithMatch(
        errorNotificationStub,
        `Upload Artifact cancelled: Unsupported cloud provider: ${mockGCPRegion.provider}`,
      );

      assert.strictEqual(result, undefined);
    });

    it("should silently return if user cancels the file selection", async () => {
      sandbox.stub(vscode.window, "showOpenDialog").resolves([]);
      const result = await promptForArtifactUploadParams();
      assert.strictEqual(result, undefined);
    });

    it("should show warning notification if there is no artifact name", async () => {
      flinkCcloudEnvironmentQuickPickStub.resolves(mockEnvironment);
      cloudProviderRegionQuickPickStub.resolves({
        ...fakeCloudProviderRegion,
        provider: "AZURE",
      });

      sandbox.stub(vscode.window, "showOpenDialog").resolves([mockFileUri]);
      sandbox.stub(vscode.window, "showInputBox").resolves(undefined);

      const warningNotificationStub = sandbox
        .stub(notifications, "showWarningNotificationWithButtons")
        .resolves(undefined);

      const result = await promptForArtifactUploadParams();

      assert.strictEqual(result, undefined);

      sinon.assert.calledWith(
        warningNotificationStub,
        "Upload Artifact cancelled: Artifact name is required.",
      );
    });

    it("should prefill artifact name with file base name when selecting a file", async () => {
      flinkCcloudEnvironmentQuickPickStub.resolves(mockEnvironment);
      cloudProviderRegionQuickPickStub.resolves({
        ...fakeCloudProviderRegion,
        provider: "AZURE",
      });

      sandbox.stub(vscode.window, "showOpenDialog").resolves([mockFileUri]);

      const showInputBoxStub = sandbox.stub(vscode.window, "showInputBox").resolves(mockFileName);

      const result = await promptForArtifactUploadParams();

      sinon.assert.calledWithMatch(showInputBoxStub, sinon.match({ value: mockFileName }));
      assert.deepStrictEqual(result?.selectedFile, mockFileUri);
    });

    it("returns the correct Artifact upload parameters for Azure", async () => {
      flinkCcloudEnvironmentQuickPickStub.resolves(mockEnvironment);
      // reset the region quick pick stub to return a valid Azure region
      cloudProviderRegionQuickPickStub.resolves({
        ...fakeCloudProviderRegion,
        provider: "AZURE",
        region: fakeCloudProviderRegion.region_name,
      });

      sandbox.stub(vscode.window, "showOpenDialog").resolves([mockFileUri]);

      sandbox.stub(vscode.window, "showInputBox").resolves("test-artifact");

      const result = await promptForArtifactUploadParams();

      assert.deepStrictEqual(result, {
        environment: mockEnvironment.id,
        cloud: "Azure",
        region: fakeCloudProviderRegion.region_name,
        artifactName: "test-artifact",
        fileFormat: "jar",
        selectedFile: mockFileUri,
      });
    });

    it("returns the correct Artifact upload parameters for AWS", async () => {
      flinkCcloudEnvironmentQuickPickStub.resolves(mockEnvironment);

      cloudProviderRegionQuickPickStub.resolves({
        ...fakeCloudProviderRegion,
        provider: "AWS",
        region: fakeCloudProviderRegion.region_name,
      });

      sandbox.stub(vscode.window, "showOpenDialog").resolves([mockFileUri]);
      sandbox.stub(vscode.window, "showInputBox").resolves("test-artifact");

      const result = await promptForArtifactUploadParams();

      assert.deepStrictEqual(result, {
        environment: mockEnvironment.id,
        cloud: "AWS",
        region: fakeCloudProviderRegion.region_name,
        artifactName: "test-artifact",
        fileFormat: "jar",
        selectedFile: mockFileUri,
      });
    });
  });

  describe("handleUploadToCloudProvider", () => {
    const mockPresignedUrlResponse: PresignedUploadUrlArtifactV1PresignedUrl200Response = {
      api_version: PresignedUploadUrlArtifactV1PresignedUrl200ResponseApiVersionEnum.ArtifactV1,
      kind: PresignedUploadUrlArtifactV1PresignedUrl200ResponseKindEnum.PresignedUrl,
      upload_url: "https://example.com/presigned-url",
    };
    let uploadFileToAzureStub: sinon.SinonStub;
    let uploadFileToS3Stub: sinon.SinonStub;

    beforeEach(() => {
      const mockAzureResponse = new Response(null, { status: 200, statusText: "OK" });
      uploadFileToAzureStub = sandbox
        .stub(uploadToProvider, "uploadFileToAzure")
        .resolves(mockAzureResponse);

      const mockS3Response = new Response(null, { status: 204, statusText: "No Content" });
      uploadFileToS3Stub = sandbox
        .stub(uploadToProvider, "uploadFileToS3")
        .resolves(mockS3Response);

      sandbox.stub(uploadArtifactModule, "prepareUploadFileFromUri").resolves({
        blob: new Blob(["dummy"], { type: "application/java-archive" }),
        contentType: "application/java-archive",
      });
    });
    it("should log the message confirming the upload for Azure", async () => {
      const mockProgress = {
        report: sandbox.stub(),
      };

      const mockToken = {
        isCancellationRequested: false,
        onCancellationRequested: sandbox.stub(),
      };

      const withProgressStub = sandbox.stub(vscode.window, "withProgress");
      withProgressStub.callsFake(async (options, callback) => {
        return await callback(mockProgress as any, mockToken as any);
      });

      await handleUploadToCloudProvider(mockAzureParams, mockPresignedUrlResponse);

      sinon.assert.calledOnce(uploadFileToAzureStub);
      sinon.assert.calledWith(uploadFileToAzureStub, {
        file: sinon.match.any, // The blob object
        presignedUrl: mockPresignedUrlResponse.upload_url,
        contentType: "application/java-archive",
      });

      sinon.assert.calledWith(mockProgress.report, { message: "Preparing file..." });
      sinon.assert.calledWith(mockProgress.report, { message: "Uploading to Azure storage..." });
    });

    it("should upload to S3 with form data for AWS", async () => {
      const mockS3PresignedUrlResponse: PresignedUploadUrlArtifactV1PresignedUrl200Response = {
        api_version: PresignedUploadUrlArtifactV1PresignedUrl200ResponseApiVersionEnum.ArtifactV1,
        kind: PresignedUploadUrlArtifactV1PresignedUrl200ResponseKindEnum.PresignedUrl,
        upload_url: "https://test.s3.amazonaws.com/presigned-url",
        upload_form_data: {
          key: "test-key",
          policy: "base64-encoded-policy",
          "x-amz-algorithm": "AWS4-HMAC-SHA256",
          "x-amz-credential": "test-credential",
          "x-amz-date": "20240101T000000Z",
          "x-amz-signature": "test-signature",
          "x-amz-security-token": "test-security-token",
        },
      };

      const mockProgress = {
        report: sandbox.stub(),
      };

      const mockToken = {
        isCancellationRequested: false,
        onCancellationRequested: sandbox.stub(),
      };

      const withProgressStub = sandbox.stub(vscode.window, "withProgress");
      withProgressStub.callsFake(async (options, callback) => {
        return await callback(mockProgress as any, mockToken as any);
      });

      await handleUploadToCloudProvider(mockAwsParams, mockS3PresignedUrlResponse);

      sinon.assert.calledOnce(uploadFileToS3Stub);
      sinon.assert.calledWith(uploadFileToS3Stub, {
        file: sinon.match.any, // The blob object
        presignedUrl: mockS3PresignedUrlResponse.upload_url,
        contentType: "application/java-archive",
        uploadFormData: mockS3PresignedUrlResponse.upload_form_data,
      });

      sinon.assert.calledWith(mockProgress.report, { message: "Preparing file..." });
      sinon.assert.calledWith(mockProgress.report, { message: "Uploading to AWS storage..." });
    });

    it("should throw error when AWS upload form data is missing", async () => {
      const mockS3PresignedUrlResponseNoFormData: PresignedUploadUrlArtifactV1PresignedUrl200Response =
        {
          api_version: PresignedUploadUrlArtifactV1PresignedUrl200ResponseApiVersionEnum.ArtifactV1,
          kind: PresignedUploadUrlArtifactV1PresignedUrl200ResponseKindEnum.PresignedUrl,
          upload_url: "https://test.s3.amazonaws.com/presigned-url",
          // upload_form_data is missing
        };

      const mockProgress = {
        report: sandbox.stub(),
      };

      const mockToken = {
        isCancellationRequested: false,
        onCancellationRequested: sandbox.stub(),
      };

      const withProgressStub = sandbox.stub(vscode.window, "withProgress");
      withProgressStub.callsFake(async (options, callback) => {
        return await callback(mockProgress as any, mockToken as any);
      });

      await assert.rejects(
        handleUploadToCloudProvider(mockAwsParams, mockS3PresignedUrlResponseNoFormData),
        /AWS upload form data is missing from presigned URL response/,
      );

      sinon.assert.notCalled(uploadFileToS3Stub);
    });

    describe("buildCreateArtifactRequest", () => {
      it("should build the artifact request correctly", () => {
        const uploadId = "upload-id-123";
        const request = buildCreateArtifactRequest(mockAzureParams, uploadId);

        assert.deepStrictEqual(request, {
          cloud: mockAzureParams.cloud,
          region: mockAzureParams.region,
          environment: mockAzureParams.environment,
          display_name: mockAzureParams.artifactName,
          content_format: mockAzureParams.fileFormat.toUpperCase(),
          upload_source: {
            location: PRESIGNED_URL_LOCATION,
            upload_id: uploadId,
          },
        });
      });
    });
    describe("uploadArtifactToCCloud", () => {
      let stubbedFlinkArtifactsApi: sinon.SinonStubbedInstance<FlinkArtifactsArtifactV1Api>;
      let stubbedSidecarHandle: ReturnType<typeof getSidecarStub>;

      beforeEach(() => {
        stubbedFlinkArtifactsApi = sandbox.createStubInstance(FlinkArtifactsArtifactV1Api);
        stubbedSidecarHandle = getSidecarStub(sandbox);
        stubbedSidecarHandle.getFlinkArtifactsApi.returns(stubbedFlinkArtifactsApi);
      });

      it("should upload the artifact to Confluent Cloud", async () => {
        const mockUploadId = "upload-id-123";
        stubbedFlinkArtifactsApi.createArtifactV1FlinkArtifact.resolves({
          id: "artifact-id-123",
          cloud: "",
          region: "",
          environment: "",
          display_name: "",
        });

        await uploadArtifactToCCloud(mockAzureParams, mockUploadId);

        sinon.assert.calledOnce(stubbedFlinkArtifactsApi.createArtifactV1FlinkArtifact);
        sinon.assert.calledWith(stubbedFlinkArtifactsApi.createArtifactV1FlinkArtifact, {
          CreateArtifactV1FlinkArtifactRequest: buildCreateArtifactRequest(
            mockAzureParams,
            mockUploadId,
          ),
          cloud: mockAzureParams.cloud,
          region: mockAzureParams.region,
        });
      });

      it("should show an error notification if the upload fails", async () => {
        stubbedFlinkArtifactsApi.createArtifactV1FlinkArtifact.rejects(
          createResponseError(500, "Internal Server Error", "Upload failed"),
        );

        const errorNotificationStub = getShowErrorNotificationWithButtonsStub(sandbox);

        await assert.rejects(uploadArtifactToCCloud(mockAzureParams, "upload-id-123"));

        sinon.assert.calledOnce(errorNotificationStub);
        sinon.assert.calledWith(
          errorNotificationStub,
          "Failed to create Flink artifact: Upload failed",
        );
      });

      it("should parse and display JSON error details from ResponseError", async () => {
        const mockUploadId = "upload-id-123";

        const responseError = createResponseError(409, "Conflict", "artifact already exists");

        stubbedFlinkArtifactsApi.createArtifactV1FlinkArtifact.rejects(responseError);

        const errorNotificationStub = sandbox
          .stub(notifications, "showErrorNotificationWithButtons")
          .resolves();

        await assert.rejects(uploadArtifactToCCloud(mockAzureParams, mockUploadId), responseError);

        sinon.assert.calledOnce(errorNotificationStub);
        sinon.assert.calledWith(
          errorNotificationStub,
          `Failed to create Flink artifact: artifact already exists`,
        );
      });

      it("should parse and display text error details from ResponseError", async () => {
        const mockUploadId = "upload-id-123";
        const textBody = "artifact already exists";

        const responseError = createResponseError(409, "Conflict", textBody);
        stubbedFlinkArtifactsApi.createArtifactV1FlinkArtifact.rejects(responseError);

        const errorNotificationStub = sandbox
          .stub(notifications, "showErrorNotificationWithButtons")
          .resolves();

        await assert.rejects(uploadArtifactToCCloud(mockAzureParams, mockUploadId), responseError);

        sinon.assert.calledOnce(errorNotificationStub);
        sinon.assert.calledWith(
          errorNotificationStub,
          `Failed to create Flink artifact: ${textBody}`,
        );
      });
    });
  });
});
