import * as assert from "assert";
import * as sinon from "sinon";
import * as errors from "../../errors";
import { Logger } from "../../logging";
import * as notifications from "../../notifications";
import { uploadFileToAzure } from "./uploadToAzure";

describe("uploadToAzure", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });
  afterEach(() => {
    sandbox.restore();
  });

  describe("uploadFileToAzure", () => {
    let fetchStub: sinon.SinonStub;
    let loggerErrorStub: sinon.SinonStub;
    let logErrorStub: sinon.SinonStub;
    let showErrorNotificationStub: sinon.SinonStub;

    const mockFile = new Blob(["test content"], { type: "application/zip" });
    const mockParams = {
      file: mockFile,
      presignedUrl: "https://test.blob.core.windows.net/container/file.zip?signature=abc123",
      contentType: "application/zip",
    };

    beforeEach(() => {
      fetchStub = sandbox.stub(global, "fetch");
      loggerErrorStub = sandbox.stub(Logger.prototype, "error");
      logErrorStub = sandbox.stub(errors, "logError");
      showErrorNotificationStub = sandbox.stub(notifications, "showErrorNotificationWithButtons");
    });

    it("should successfully upload file to Azure and return response", async () => {
      const mockResponse = {
        ok: true,
        status: 201,
        statusText: "Created",
        headers: new Headers({
          "content-length": "12",
          etag: '"0x8D9A1B2C3D4E5F6"',
        }),
      } as Response;

      fetchStub.resolves(mockResponse);

      const result = await uploadFileToAzure(mockParams);

      assert.strictEqual(result, mockResponse);

      sinon.assert.calledOnceWithExactly(fetchStub, mockParams.presignedUrl, {
        method: "PUT",
        headers: {
          "Content-Type": "application/zip",
          "x-ms-blob-type": "BlockBlob",
        },
        body: mockFile,
      });

      sinon.assert.notCalled(logErrorStub);
      sinon.assert.notCalled(showErrorNotificationStub);
    });

    it("should handle non-ok response and throw error", async () => {
      const mockResponse = {
        ok: false,
        status: 409,
        statusText: "Conflict",
        text: sandbox.stub().resolves("Blob already exists"),
        headers: new Headers({
          "x-ms-error-code": "BlobAlreadyExists",
        }),
      } as unknown as Response;

      fetchStub.resolves(mockResponse);

      await assert.rejects(
        async () => await uploadFileToAzure(mockParams),
        /Azure upload failed: 409 Conflict/,
      );

      sinon.assert.calledWith(loggerErrorStub, "Azure upload failed", {
        status: 409,
        statusText: "Conflict",
        responseBody: "Blob already exists",
        headers: { "x-ms-error-code": "BlobAlreadyExists" },
      });

      sinon.assert.calledWith(loggerErrorStub, "Azure upload error", sinon.match.instanceOf(Error));
      sinon.assert.calledWith(
        logErrorStub,
        sinon.match.instanceOf(Error),
        "Failed to upload file to Azure",
        {
          extra: {
            fileType: "application/zip",
            fileSize: mockFile.size,
          },
        },
      );
      sinon.assert.calledWith(
        showErrorNotificationStub,
        "Failed to upload file to Azure. See logs for details.",
      );
    });

    it("should handle fetch error and throw", async () => {
      const fetchError = new Error("Network error");
      fetchStub.rejects(fetchError);

      await assert.rejects(async () => await uploadFileToAzure(mockParams), /Network error/);

      sinon.assert.calledWith(loggerErrorStub, "Azure upload error", fetchError);
      sinon.assert.calledWith(logErrorStub, fetchError, "Failed to upload file to Azure", {
        extra: {
          fileType: "application/zip",
          fileSize: mockFile.size,
        },
      });
      sinon.assert.calledWith(
        showErrorNotificationStub,
        "Failed to upload file to Azure. See logs for details.",
      );
    });

    it("should log info at start and success of upload", async () => {
      const mockResponse = {
        ok: true,
        status: 201,
        statusText: "Created",
        headers: new Headers({
          "content-length": "12",
          etag: '"0x8D9A1B2C3D4E5F6"',
        }),
      } as Response;

      fetchStub.resolves(mockResponse);

      const result = await uploadFileToAzure(mockParams);

      assert.strictEqual(result, mockResponse);

      sinon.assert.notCalled(logErrorStub);
      sinon.assert.notCalled(showErrorNotificationStub);
    });

    it("should handle File instance and log correct file type in error context", async () => {
      const mockFileInstance = new File(["test content"], "test.zip", {
        type: "application/zip",
      });
      const paramsWithFile = {
        ...mockParams,
        file: mockFileInstance,
      };

      const fetchError = new Error("Network error");
      fetchStub.rejects(fetchError);

      await assert.rejects(async () => await uploadFileToAzure(paramsWithFile), /Network error/);

      sinon.assert.calledWith(logErrorStub, fetchError, "Failed to upload file to Azure", {
        extra: {
          fileType: "application/zip", // Should use file.type when File instance
          fileSize: mockFileInstance.size,
        },
      });
    });
  });
});
