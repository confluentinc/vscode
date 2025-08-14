import * as assert from "assert";
import * as sinon from "sinon";
import type { PresignedUploadUrlArtifactV1PresignedUrlRequest } from "../clients/flinkArtifacts";
import * as errorsModule from "../errors";
import * as sidecarModule from "../sidecar";
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

  describe("uploadUDFCommand", () => {});
});
