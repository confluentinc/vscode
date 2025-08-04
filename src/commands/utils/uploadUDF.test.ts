import * as assert from "assert";
import * as sinon from "sinon";
import {
  PresignedUploadUrlArtifactV1PresignedUrl200Response,
  PresignedUploadUrlArtifactV1PresignedUrl200ResponseApiVersionEnum,
  PresignedUploadUrlArtifactV1PresignedUrl200ResponseKindEnum,
  PresignedUploadUrlArtifactV1PresignedUrlRequest,
} from "../../clients/flinkArtifacts";
import * as errors from "../../errors";
import * as notifications from "../../notifications";
import * as sidecar from "../../sidecar";
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

    it("should return undefined and log error when request fails", async () => {
      const mockRequest: PresignedUploadUrlArtifactV1PresignedUrlRequest = {
        environment: "env-123",
        cloud: "AWS",
        region: "us-west-2",
        id: "test-artifact",
        content_format: "jar",
      };

      const mockError = new Error("API request failed");
      sandbox.stub(sidecar, "getSidecar").rejects(mockError);
      const logErrorStub = sandbox.stub(errors, "logError");

      const result = await getPresignedUploadUrl(mockRequest);

      assert.strictEqual(result, undefined);
      sinon.assert.calledOnceWithExactly(
        logErrorStub,
        mockError,
        "Failed to get presigned upload URL",
      );
    });
  });

  it("should show error notification when response is undefined", async () => {
    const mockRequest: PresignedUploadUrlArtifactV1PresignedUrlRequest = {
      environment: "env-123",
      cloud: "AWS",
      region: "us-west-2",
      id: "test-artifact",
      content_format: "jar",
    };

    sandbox.stub(sidecar, "getSidecar").rejects(new Error("Failed"));
    sandbox.stub(errors, "logError");
    const showErrorStub = sandbox.stub(notifications, "showErrorNotificationWithButtons");

    await handlePresignedUrlRequest(mockRequest);

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

    sandbox.stub(sidecar, "getSidecar").resolves({
      getFlinkPresignedUrlsApi: () => ({
        presignedUploadUrlArtifactV1PresignedUrl: sandbox.stub().resolves(mockResponse),
      }),
    } as any);
    const showErrorStub = sandbox.stub(notifications, "showErrorNotificationWithButtons");

    await handlePresignedUrlRequest(mockRequest);

    sinon.assert.calledOnceWithExactly(
      showErrorStub,
      "Failed to get presigned upload URL. See logs for details.",
    );
  });
});
