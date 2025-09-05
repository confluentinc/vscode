import assert from "assert";
import * as sinon from "sinon";
import * as notifications from "../../notifications";
import { uploadFileToAzure, uploadFileToS3 } from "./uploadToProvider";

describe("uploadToProvider", () => {
  let sandbox: sinon.SinonSandbox;
  let fetchStub: sinon.SinonStub;
  let showErrorNotificationStub: sinon.SinonStub;
  const mockParams = {
    file: new Blob(["test content"], { type: "application/zip" }),
    presignedUrl: "https://test.blob.core.windows.net/container/file.zip?signature=abc123",
    contentType: "application/zip",
  };
  afterEach(() => {
    sandbox.restore();
  });
  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });
  describe("uploadFileToAzure", () => {
    beforeEach(() => {
      fetchStub = sandbox.stub(global, "fetch");
      showErrorNotificationStub = sandbox.stub(notifications, "showErrorNotificationWithButtons");
    });

    it("should return response on successful upload", async () => {
      const mockResponse = new Response(null, { status: 200, statusText: "OK" });
      fetchStub.resolves(mockResponse);

      const response = await uploadFileToAzure(mockParams);

      sinon.assert.calledWith(fetchStub, mockParams.presignedUrl, {
        method: "PUT",
        headers: {
          "Content-Type": mockParams.contentType,
          "x-ms-blob-type": "BlockBlob",
        },
        body: mockParams.file,
      });
      sinon.assert.notCalled(showErrorNotificationStub);
      assert.strictEqual(response, mockResponse);
    });

    it("should throw error on failed upload", async () => {
      const mockResponse = new Response("Upload failed", {
        status: 400,
        statusText: "Bad Request",
      });

      sandbox
        .stub(mockResponse.headers, "entries")
        .returns([["content-type", "text/plain;charset=UTF-8"]] as any);

      fetchStub.resolves(mockResponse);

      await assert.rejects(async () => {
        await uploadFileToAzure(mockParams);
      });

      sinon.assert.calledWith(
        fetchStub,
        mockParams.presignedUrl,
        sinon.match({
          method: "PUT",
          body: mockParams.file,
        }),
      );

      sinon.assert.calledOnce(showErrorNotificationStub);
    });
  });

  describe("uploadFileToS3", () => {
    let mockParams: {
      file: Blob;
      presignedUrl: string;
      contentType: string;
      uploadFormData: { [key: string]: string };
    };

    beforeEach(() => {
      fetchStub = sandbox.stub(global, "fetch");
      showErrorNotificationStub = sandbox.stub(notifications, "showErrorNotificationWithButtons");

      mockParams = {
        file: new Blob(["test content"], { type: "application/java-archive" }),
        presignedUrl: "https://test.s3.amazonaws.com/file.jar",
        contentType: "application/java-archive",
        uploadFormData: {
          key: "test-key",
          policy: "base64-encoded-policy",
          "x-amz-algorithm": "AWS4-HMAC-SHA256",
          "x-amz-credential": "test-credential",
          "x-amz-date": "20240101T000000Z",
          "x-amz-signature": "test-signature",
          "x-amz-security-token": "test-security-token",
        },
      };
    });

    it("should return response on successful upload", async () => {
      const mockResponse = new Response(null, {
        status: 204,
        statusText: "No Content",
        headers: new Headers({
          etag: '"test-etag"',
          "x-amz-request-id": "test-request-id",
        }),
      });
      fetchStub.resolves(mockResponse);

      const response = await uploadFileToS3(mockParams);

      // check that the form data is correct
      const expectedFormDataKeys = [...Object.keys(mockParams.uploadFormData), "file"];
      sinon.assert.calledWith(
        fetchStub,
        mockParams.presignedUrl,
        sinon.match({
          method: "POST",
          body: sinon.match((value) => {
            if (!(value instanceof FormData)) return false;
            const formDataKeys = Array.from(value.keys());
            return expectedFormDataKeys.every((key) => formDataKeys.includes(key));
          }),
        }),
      );
      sinon.assert.notCalled(showErrorNotificationStub);

      assert.strictEqual(response, mockResponse);
    });

    it("should handle XML error details on error upload ", async () => {
      const errorResponseBody = `<?xml version="1.0" encoding="UTF-8"?>
<Error>
  <Code>AccessDenied</Code>
  <Message>Access Denied</Message>
</Error>`;
      const mockResponse = new Response(errorResponseBody, {
        status: 403,
        statusText: "Forbidden",
      });
      fetchStub.resolves(mockResponse);

      let thrownError: Error | undefined;
      try {
        await uploadFileToS3(mockParams);
      } catch (error) {
        thrownError = error as Error;
      }

      assert(thrownError instanceof Error);
      assert(thrownError.message.includes("403 Forbidden"));
      assert((thrownError as any).responseText.includes(errorResponseBody));

      sinon.assert.calledOnce(showErrorNotificationStub);

      sinon.assert.calledOnce(fetchStub);
    });

    it("should handle upload failure without response body", async () => {
      const mockResponse = new Response(null, {
        status: 500,
        statusText: "Internal Server Error",
      });
      fetchStub.resolves(mockResponse);

      let thrownError: Error | undefined;
      try {
        await uploadFileToS3(mockParams);
      } catch (error) {
        thrownError = error as Error;
      }

      assert(thrownError instanceof Error);
      assert.strictEqual(thrownError.message, "500 Internal Server Error");

      sinon.assert.calledOnce(showErrorNotificationStub);

      sinon.assert.calledOnce(fetchStub);
    });
  });
});
