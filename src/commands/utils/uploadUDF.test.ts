import { expect } from "@playwright/test";
import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import path from "path";
import * as sinon from "sinon";
import * as vscode from "vscode";

import { TEST_CCLOUD_ENVIRONMENT } from "../../../tests/unit/testResources";
import {
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
import * as uploadToAzure from "./uploadToAzure";
import {
  getPresignedUploadUrl,
  handleUploadFile,
  prepareUploadFileFromUri,
  promptForUDFUploadParams,
} from "./uploadUDF";
describe("uploadUDF", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
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
      await expect(prepareUploadFileFromUri(mockUri)).rejects.toThrow(Error);
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
      expect(response).toStrictEqual({
        api_version: "artifact/v1",
        kind: "PresignedUrl",
        upload_url: "https://example.com/presigned-url",
      });
    });
  });

  describe("promptForUDFUploadParams", () => {
    let flinkCcloudEnvironmentQuickPickStub: sinon.SinonStub;
    let cloudProviderRegionQuickPickStub: sinon.SinonStub;
    const fakeCloudProviderRegion: FcpmV2RegionListDataInner = {
      id: "australiaeast",
      cloud: CloudProvider.Azure,
      display_name: "Australia East",
      region_name: "australiaeast",
      metadata: {} as any,
      http_endpoint: "",
    };
    const mockEnvironment = TEST_CCLOUD_ENVIRONMENT;
    const mockFileUri = vscode.Uri.file("/path/to/file.jar");
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
      const result = await promptForUDFUploadParams();
      assert.strictEqual(result, undefined);
    });

    it("should return undefined if region is not selected", async () => {
      flinkCcloudEnvironmentQuickPickStub.resolves(TEST_CCLOUD_ENVIRONMENT);
      const result = await promptForUDFUploadParams();
      assert.strictEqual(result, undefined);
    });

    it("should show error and return undefined for non-Azure cloud providers", async () => {
      flinkCcloudEnvironmentQuickPickStub.resolves(TEST_CCLOUD_ENVIRONMENT);
      cloudProviderRegionQuickPickStub.resolves(fakeCloudProviderRegion);

      const mockAwsRegion = {
        id: "us-west-2",
        provider: "AWS" as CloudProvider,
        displayName: "US West (Oregon)",
        regionName: "us-west-2",
        region: "us-west-2",
      };

      cloudProviderRegionQuickPickStub.resolves(mockAwsRegion);

      const errorNotificationStub = sandbox.stub(vscode.window, "showErrorMessage").resolves();

      const result = await promptForUDFUploadParams();

      sinon.assert.calledWithMatch(
        errorNotificationStub,
        `Upload UDF cancelled: Unsupported cloud provider: ${mockAwsRegion.provider}`,
      );

      assert.strictEqual(result, undefined);
    });
    it("should silently return if user cancels the file selection", async () => {
      sandbox.stub(vscode.window, "showOpenDialog").resolves([]);
      const result = await promptForUDFUploadParams();
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

      const result = await promptForUDFUploadParams();

      assert.strictEqual(result, undefined);

      sinon.assert.calledWith(
        warningNotificationStub,
        "Upload UDF cancelled: Artifact name is required.",
      );
    });

    it("returns the correct UDF upload parameters", async () => {
      flinkCcloudEnvironmentQuickPickStub.resolves(mockEnvironment);
      // reset the region quick pick stub to return a valid Azure region
      cloudProviderRegionQuickPickStub.resolves({
        ...fakeCloudProviderRegion,
        provider: "AZURE",
        region: fakeCloudProviderRegion.region_name,
      });

      sandbox.stub(vscode.window, "showOpenDialog").resolves([mockFileUri]);

      sandbox.stub(vscode.window, "showInputBox").resolves("test-artifact");

      const result = await promptForUDFUploadParams();

      assert.deepStrictEqual(result, {
        environment: mockEnvironment.id,
        cloud: "Azure",
        region: fakeCloudProviderRegion.region_name,
        artifactName: "test-artifact",
        fileFormat: "jar",
        selectedFile: mockFileUri,
      });
    });
  });

  describe("handleUploadFile", () => {
    const mockPresignedUrlResponse: PresignedUploadUrlArtifactV1PresignedUrl200Response = {
      api_version: PresignedUploadUrlArtifactV1PresignedUrl200ResponseApiVersionEnum.ArtifactV1,
      kind: PresignedUploadUrlArtifactV1PresignedUrl200ResponseKindEnum.PresignedUrl,
      upload_url: "https://example.com/presigned-url",
    };
    let tempJarPath: string;
    let tempJarUri: vscode.Uri;
    let uploadFileToAzureStub: sinon.SinonStub;

    beforeEach(() => {
      const tempDir = os.tmpdir();
      tempJarPath = path.join(tempDir, `test-udf-${Date.now()}.jar`);
      fs.writeFileSync(tempJarPath, "dummy jar content");
      tempJarUri = vscode.Uri.file(tempJarPath);

      // Simple mock Response - follows the pattern from uploadToAzure.test.ts
      const mockResponse = new Response(null, { status: 200, statusText: "OK" });
      uploadFileToAzureStub = sandbox
        .stub(uploadToAzure, "uploadFileToAzure")
        .resolves(mockResponse);
    });
    afterEach(() => {
      // Clean up the temporary file after each test
      if (fs.existsSync(tempJarPath)) {
        fs.unlinkSync(tempJarPath);
      }
    });
    it("should log the message confirming the upload", async () => {
      const mockParams = {
        environment: "env-123456",
        cloud: "Azure",
        region: "australiaeast",
        artifactName: "test-artifact",
        fileFormat: "jar",
        selectedFile: tempJarUri,
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

      await handleUploadFile(mockParams, mockPresignedUrlResponse);
      sinon.assert.calledOnce(uploadFileToAzureStub);
      sinon.assert.calledWith(uploadFileToAzureStub, {
        file: sinon.match.any, // The blob object
        presignedUrl: mockPresignedUrlResponse.upload_url,
        contentType: "application/java-archive",
      });

      sinon.assert.calledWith(mockProgress.report, { message: "Preparing file..." });
      sinon.assert.calledWith(mockProgress.report, { message: "Uploading to Azure storage..." });
    });

    it("should handle upload errors properly", async () => {
      const mockParams = {
        environment: "env-123456",
        cloud: "Azure",
        region: "australiaeast",
        artifactName: "test-artifact",
        fileFormat: "jar",
        selectedFile: tempJarUri,
      };

      // Make the upload function throw an error
      const uploadError = new Error("Azure upload failed: 500 Internal Server Error");
      uploadFileToAzureStub.rejects(uploadError);

      // The function should rethrow the error
      await assert.rejects(
        () => handleUploadFile(mockParams, mockPresignedUrlResponse),
        uploadError,
      );

      sinon.assert.calledOnce(uploadFileToAzureStub);
    });
  });
});
