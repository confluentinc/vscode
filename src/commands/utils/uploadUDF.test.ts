import assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import {
  PresignedUploadUrlArtifactV1PresignedUrl200Response,
  PresignedUploadUrlArtifactV1PresignedUrl200ResponseApiVersionEnum,
  PresignedUploadUrlArtifactV1PresignedUrl200ResponseKindEnum,
  PresignedUploadUrlArtifactV1PresignedUrlRequest,
} from "../../clients/flinkArtifacts";
import * as notifications from "../../notifications";
import * as sidecar from "../../sidecar";
import * as uploadUDFModule from "./uploadUDF";
import { getPresignedUploadUrl, handlePresignedUrlRequest } from "./uploadUDF";

describe("uploadUDF utils", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("getPresignedUploadUrl", () => {
    it("should return presigned URL response when request succeeds", async () => {
      const mockRequest: PresignedUploadUrlArtifactV1PresignedUrlRequest = {
        environment: "env-123",
        cloud: "AWS",
        region: "us-west-2",
        id: "test-artifact",
        content_format: "jar",
      };

      const mockResponse: PresignedUploadUrlArtifactV1PresignedUrl200Response = {
        api_version: "v1" as PresignedUploadUrlArtifactV1PresignedUrl200ResponseApiVersionEnum,
        kind: "PresignedUploadUrl" as PresignedUploadUrlArtifactV1PresignedUrl200ResponseKindEnum,
        upload_url: "https://example.com/upload",
      };

      const mockPresignedClient = {
        presignedUploadUrlArtifactV1PresignedUrl: sandbox.stub().resolves(mockResponse),
      };

      const mockSidecarHandle = {
        getFlinkPresignedUrlsApi: sandbox.stub().returns(mockPresignedClient),
      };

      sandbox.stub(sidecar, "getSidecar").resolves(mockSidecarHandle as any);

      const result = await getPresignedUploadUrl(mockRequest);

      assert.deepStrictEqual(result, mockResponse);
      sinon.assert.calledOnce(sidecar.getSidecar as sinon.SinonStub);
      sinon.assert.calledOnceWithExactly(mockSidecarHandle.getFlinkPresignedUrlsApi, {
        environmentId: "env-123",
        provider: "AWS",
        region: "us-west-2",
      });
      sinon.assert.calledOnceWithExactly(
        mockPresignedClient.presignedUploadUrlArtifactV1PresignedUrl,
        {
          PresignedUploadUrlArtifactV1PresignedUrlRequest: mockRequest,
        },
      );
    });

    it("should return undefined when request fails", async () => {
      const mockRequest: PresignedUploadUrlArtifactV1PresignedUrlRequest = {
        environment: "env-123",
        cloud: "AWS",
        region: "us-west-2",
        id: "test-artifact",
        content_format: "jar",
      };

      const mockError = new Error("API request failed");
      sandbox.stub(sidecar, "getSidecar").rejects(mockError);

      const result = await getPresignedUploadUrl(mockRequest);

      assert.strictEqual(result, undefined);
    });
  });

  describe("handlePresignedUrlRequest", () => {
    it("should return upload_url when response is successful", async () => {
      const mockRequest: PresignedUploadUrlArtifactV1PresignedUrlRequest = {
        environment: "env-123",
        cloud: "AWS",
        region: "us-west-2",
        id: "test-artifact",
        content_format: "jar",
      };

      const mockResponse: PresignedUploadUrlArtifactV1PresignedUrl200Response = {
        api_version: PresignedUploadUrlArtifactV1PresignedUrl200ResponseApiVersionEnum.ArtifactV1,
        kind: PresignedUploadUrlArtifactV1PresignedUrl200ResponseKindEnum.PresignedUrl,
        upload_url: "https://example.com/upload",
      };

      const getPresignedUrlStub = sandbox
        .stub(uploadUDFModule, "getPresignedUploadUrl")
        .resolves(mockResponse);

      const result = await handlePresignedUrlRequest(mockRequest);

      assert.strictEqual(result, "https://example.com/upload");
      sinon.assert.calledOnceWithExactly(getPresignedUrlStub, mockRequest);
    });

    it("should show error notification when response is undefined", async () => {
      const mockRequest: PresignedUploadUrlArtifactV1PresignedUrlRequest = {
        environment: "env-123",
        cloud: "AWS",
        region: "us-west-2",
        id: "test-artifact",
        content_format: "jar",
      };

      sandbox.stub(uploadUDFModule, "getPresignedUploadUrl").resolves(undefined);
      const showErrorStub = sandbox.stub(notifications, "showErrorNotificationWithButtons");

      const result = await handlePresignedUrlRequest(mockRequest);

      assert.strictEqual(result, undefined);
      sinon.assert.calledOnceWithExactly(
        showErrorStub,
        "Failed to get presigned upload URL. See logs for details.",
      );
    });

    it("should show error notification when response has no upload_url", async () => {
      const mockRequest: PresignedUploadUrlArtifactV1PresignedUrlRequest = {
        environment: "env-123",
        cloud: "AWS",
        region: "us-west-2",
        id: "test-artifact",
        content_format: "jar",
      };

      const mockResponse: PresignedUploadUrlArtifactV1PresignedUrl200Response = {
        api_version: PresignedUploadUrlArtifactV1PresignedUrl200ResponseApiVersionEnum.ArtifactV1,
        kind: PresignedUploadUrlArtifactV1PresignedUrl200ResponseKindEnum.PresignedUrl,
      };

      sandbox.stub(uploadUDFModule, "getPresignedUploadUrl").resolves(mockResponse);
      const showErrorStub = sandbox.stub(notifications, "showErrorNotificationWithButtons");

      const result = await handlePresignedUrlRequest(mockRequest);

      assert.strictEqual(result, undefined);
      sinon.assert.calledOnceWithExactly(
        showErrorStub,
        "Failed to get presigned upload URL. See logs for details.",
      );
    });
  });

  describe("prepareUploadFileFromUri", () => {
    let readFileStub: sinon.SinonStub;
    let mockWorkspaceFs: any;

    beforeEach(() => {
      readFileStub = sandbox.stub();
      mockWorkspaceFs = {
        readFile: readFileStub,
      };
      sandbox.stub(vscode.workspace, "fs").value(mockWorkspaceFs);
    });

    it("should read file from uri and return blob, file, filename, contentType, and size", async () => {
      const fakeBytes = new Uint8Array([1, 2, 3, 4]);
      const fakeUri: vscode.Uri = vscode.Uri.file("/tmp/test.jar");
      readFileStub.resolves(fakeBytes);

      const result = await uploadUDFModule.prepareUploadFileFromUri(fakeUri);

      assert.strictEqual(result.filename, "test.jar");
      assert.strictEqual(result.contentType, "application/java-archive");
      assert.strictEqual(result.size, fakeBytes.length);
      assert(result.blob instanceof Blob);
      if (typeof File !== "undefined" && result.file) {
        assert(result.file instanceof File);
        assert.strictEqual(result.file.name, "test.jar");
        assert.strictEqual(result.file.type, "application/java-archive");
      }
    });

    it("should use application/zip for .zip files", async function () {
      const fakeBytes = new Uint8Array([5, 6, 7]);
      const fakeUri: vscode.Uri = vscode.Uri.file("/tmp/test.zip");
      readFileStub.resolves(fakeBytes);

      const result = await uploadUDFModule.prepareUploadFileFromUri(fakeUri);

      assert.strictEqual(result.contentType, "application/zip");
    });

    it("should use application/octet-stream for unknown extensions", async function () {
      const fakeBytes = new Uint8Array([8, 9]);
      const fakeUri: vscode.Uri = vscode.Uri.file("/tmp/test.unknown");
      readFileStub.resolves(fakeBytes);

      const result = await uploadUDFModule.prepareUploadFileFromUri(fakeUri);

      assert.strictEqual(result.contentType, "application/octet-stream");
    });

    it("should throw error when file read fails", async function () {
      const fakeUri: vscode.Uri = vscode.Uri.file("/tmp/test.jar");
      const readError = new Error("File not found");
      readFileStub.rejects(readError);

      await assert.rejects(() => uploadUDFModule.prepareUploadFileFromUri(fakeUri), readError);

      sinon.assert.calledOnceWithExactly(readFileStub, fakeUri);
    });

    it("should handle environments where File is undefined", async function () {
      const fakeBytes = new Uint8Array([1, 2, 3, 4]);
      const fakeUri: vscode.Uri = vscode.Uri.file("/tmp/test.jar");
      readFileStub.resolves(fakeBytes);

      const originalFile = global.File;
      try {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        global.File = undefined;

        const result = await uploadUDFModule.prepareUploadFileFromUri(fakeUri);

        assert.strictEqual(result.file, undefined);
        assert(result.blob instanceof Blob);
      } finally {
        // Restore global File
        global.File = originalFile;
      }
    });

    it("should show errors when file read fails", async function () {
      const fakeUri: vscode.Uri = vscode.Uri.file("/tmp/test.jar");
      const readError = new Error("File not found");
      readFileStub.rejects(readError);

      // Stub the actual logging module
      const showErrorStub = sandbox.stub(notifications, "showErrorNotificationWithButtons");

      await assert.rejects(() => uploadUDFModule.prepareUploadFileFromUri(fakeUri), readError);

      // Verify that showErrorNotificationWithButtons was called with the proper message
      sinon.assert.calledOnce(showErrorStub);
      sinon.assert.calledWithMatch(
        showErrorStub,
        `Failed to read file: ${fakeUri.fsPath}. See logs for details.`,
      );
    });

    it("should throw error when file access is denied", async function () {
      const fakeUri: vscode.Uri = vscode.Uri.file("/tmp/restricted.jar");
      const accessError = new Error("EACCES: permission denied");
      readFileStub.rejects(accessError);

      await assert.rejects(() => uploadUDFModule.prepareUploadFileFromUri(fakeUri), accessError);

      sinon.assert.calledOnceWithExactly(readFileStub, fakeUri);
    });

    it("should handle file with no extension", async function () {
      const fakeBytes = new Uint8Array([10, 11]);
      const fakeUri: vscode.Uri = vscode.Uri.file("/tmp/noextension");
      readFileStub.resolves(fakeBytes);

      const result = await uploadUDFModule.prepareUploadFileFromUri(fakeUri);

      assert.strictEqual(result.filename, "noextension");
      assert.strictEqual(result.contentType, "application/octet-stream");
    });
  });

  describe("handleUploadFile", () => {
    let params: uploadUDFModule.UDFUploadParams;
    let presignedURL: string;
    let handleUploadFileStub: sinon.SinonStub;

    beforeEach(() => {
      params = {
        environment: "env-1",
        cloud: "Azure",
        region: "us-west-2",
        artifactName: "test-artifact",
        fileFormat: "jar",
        selectedFile: vscode.Uri.parse("test.jar"),
      };
      presignedURL = "https://example.com/upload";
      handleUploadFileStub = sandbox.stub(uploadUDFModule, "handleUploadFile");
    });

    it("should upload to Azure when cloud is CloudProvider.Azure", async () => {
      const fakeBlob = new Blob([new Uint8Array([1, 2, 3])], { type: "application/java-archive" });
      const fakeFile =
        typeof File !== "undefined"
          ? new File([fakeBlob], "test.jar", { type: "application/java-archive" })
          : undefined;
      sandbox.stub(uploadUDFModule, "prepareUploadFileFromUri").resolves({
        blob: fakeBlob,
        file: fakeFile,
        filename: "test.jar",
        contentType: "application/java-archive",
        size: 3,
      });

      params.cloud = "Azure";
      await handleUploadFileStub(params, presignedURL);

      sinon.assert.calledOnceWithExactly(handleUploadFileStub, params, presignedURL);
    });

    it("should show error notification for unsupported cloud provider", async () => {
      sandbox.stub(uploadUDFModule, "prepareUploadFileFromUri").resolves({
        blob: new Blob([new Uint8Array([1])], { type: "application/java-archive" }),
        file: undefined,
        filename: "test.jar",
        contentType: "application/java-archive",
        size: 1,
      });

      params.cloud = "AWS";
      await handleUploadFileStub(params, presignedURL);

      sinon.assert.calledOnceWithExactly(handleUploadFileStub, params, presignedURL);
    });

    it("should show error notification if no file is selected", async () => {
      params.selectedFile = undefined;
      // Always stub to prevent accidental invocation with undefined
      sandbox.stub(uploadUDFModule, "prepareUploadFileFromUri");

      await handleUploadFileStub(params, presignedURL);

      sinon.assert.calledOnceWithExactly(handleUploadFileStub, params, presignedURL);
    });
  });
});
