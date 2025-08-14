import { expect } from "@playwright/test";
import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { TEST_CCLOUD_ENVIRONMENT } from "../../../tests/unit/testResources";
import {
  PresignedUploadUrlArtifactV1PresignedUrl200ResponseApiVersionEnum,
  PresignedUploadUrlArtifactV1PresignedUrl200ResponseKindEnum,
} from "../../clients/flinkArtifacts";
import { PresignedUrlsArtifactV1Api } from "../../clients/flinkArtifacts/apis/PresignedUrlsArtifactV1Api";
import { PresignedUploadUrlArtifactV1PresignedUrlRequest } from "../../clients/flinkArtifacts/models/PresignedUploadUrlArtifactV1PresignedUrlRequest";
import { CloudProvider } from "../../models/resource";
import * as cloudProviderRegions from "../../quickpicks/cloudProviderRegions";
import * as environments from "../../quickpicks/environments";
import * as sidecar from "../../sidecar";
import * as fsWrappers from "../../utils/fsWrappers";
import {
  getPresignedUploadUrl,
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
    it("should request a presigned upload URL", async () => {
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
        cloud: "aws",
        region: "us-west-2",
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
    it("should return undefined if environment is not selected", async () => {
      sandbox.stub(environments, "flinkCcloudEnvironmentQuickPick").resolves(undefined);
      const result = await promptForUDFUploadParams();
      assert.strictEqual(result, undefined);
    });

    it("should return undefined if region is not selected", async () => {
      const mockEnvironment = TEST_CCLOUD_ENVIRONMENT;
      sandbox.stub(environments, "flinkCcloudEnvironmentQuickPick").resolves(mockEnvironment);
      sandbox.stub(cloudProviderRegions, "cloudProviderRegionQuickPick").resolves(undefined);

      const result = await promptForUDFUploadParams();
      assert.strictEqual(result, undefined);
    });

    it("should show error and return undefined for non-Azure cloud providers", async () => {
      const mockEnvironment = TEST_CCLOUD_ENVIRONMENT;

      sandbox.stub(environments, "flinkCcloudEnvironmentQuickPick").resolves(mockEnvironment);

      const mockAwsRegion = {
        id: "us-west-2",
        provider: "aws" as CloudProvider,
        displayName: "US West (Oregon)",
        regionName: "us-west-2",
        region: "us-west-2",
      };

      sandbox.stub(cloudProviderRegions, "cloudProviderRegionQuickPick").resolves(mockAwsRegion);

      const errorNotificationStub = sandbox.stub(vscode.window, "showErrorMessage").resolves();

      const result = await promptForUDFUploadParams();

      sinon.assert.calledWithMatch(
        errorNotificationStub,
        "Upload UDF cancelled: Unsupported cloud provider.",
      );

      assert.strictEqual(result, undefined);
    });
  });
});
