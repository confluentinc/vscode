import assert from "assert";
import * as sinon from "sinon";
import { Logger } from "../../logging";
import * as notifications from "../../notifications";
import { uploadFileToAzure } from "./uploadToAzure";

describe("uploadFileToAzure", () => {
  let sandbox: sinon.SinonSandbox;
  let fetchStub: sinon.SinonStub;
  let loggerErrorStub: sinon.SinonStub;
  let showErrorNotificationStub: sinon.SinonStub;
  let mockParams: { file: Blob; presignedUrl: string; contentType: string };

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // Set up all stubs
    fetchStub = sandbox.stub(global, "fetch");
    loggerErrorStub = sandbox.stub(Logger.prototype, "error");
    showErrorNotificationStub = sandbox.stub(notifications, "showErrorNotificationWithButtons");

    // Set up test data
    mockParams = {
      file: new Blob(["test content"], { type: "application/zip" }),
      presignedUrl: "https://test.blob.core.windows.net/container/file.zip?signature=abc123",
      contentType: "application/zip",
    };
  });

  afterEach(() => {
    sandbox.restore();
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
    sinon.assert.notCalled(loggerErrorStub);
    sinon.assert.notCalled(showErrorNotificationStub);
    assert.strictEqual(response, mockResponse);
  });

  it("should throw error on failed upload", async () => {
    const mockResponse = new Response("Upload failed", { status: 400, statusText: "Bad Request" });

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
