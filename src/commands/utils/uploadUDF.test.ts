import { expect } from "@playwright/test";
import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import {
  PresignedUploadUrlArtifactV1PresignedUrl200ResponseApiVersionEnum,
  PresignedUploadUrlArtifactV1PresignedUrl200ResponseKindEnum,
} from "../../clients/flinkArtifacts";
import { PresignedUrlsArtifactV1Api } from "../../clients/flinkArtifacts/apis/PresignedUrlsArtifactV1Api";
import { PresignedUploadUrlArtifactV1PresignedUrlRequest } from "../../clients/flinkArtifacts/models/PresignedUploadUrlArtifactV1PresignedUrlRequest";
import * as sidecar from "../../sidecar";
import * as fsWrappers from "../../utils";
import * as quickPickUtils from "../../utils/";
import {
  getPresignedUploadUrl,
  prepareUploadFileFromUri,
  promptForUDFUploadParams,
} from "./uploadUDF";

describe("uploadUDF utils", () => {
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
      const mockQuickPick = {
        show: () => {},
        onDidAccept: (callback: () => void) => {
          callback(); // Simulate user accepting without selecting an environment
        },
      };
      sandbox.stub(vscode.window, "createQuickPick").returns(mockQuickPick as any);
      const result = await promptForUDFUploadParams();
      assert.strictEqual(result, undefined);
    });
    it("should return undefined if cloud region is not selected", async () => {
      const mockEnvironment = { id: "env-123456" };
      sandbox.stub(quickPickUtils, ).resolves(mockEnvironment);
      const mockQuickPick = {
        show: () => {},
        onDidAccept: (callback: () => void) => {
          callback(); // Simulate user accepting without selecting a cloud region
        },
      };
      sandbox.stub(vscode.window, "createQuickPick").returns(mockQuickPick as any);
      const result = await promptForUDFUploadParams();
      assert.strictEqual(result, undefined);
    });
  });
});
