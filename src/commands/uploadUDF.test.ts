import * as assert from "assert";
import * as sinon from "sinon";
import type { PresignedUploadUrlArtifactV1PresignedUrlRequest } from "../clients/flinkArtifacts";
import * as errorsModule from "../errors";
import * as sidecarModule from "../sidecar";
import { getPresignedUploadUrl } from "./uploadUDF";

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

    // Check the actual argument values for correctness
    const callArg = sidecarHandleStub.getFlinkPresignedUrlsApi.getCall(0).args[0];
    assert.strictEqual(callArg.environmentId, request.environment);
    assert.strictEqual(callArg.provider, request.cloud);
    assert.strictEqual(callArg.region, request.region);

    assert.strictEqual(result, fakeResponse);
  });

  it("should log and return undefined if the API call throws", async () => {
    const error = new Error("API failure");
    artifactsClientStub.presignedUploadUrlArtifactV1PresignedUrl.rejects(error);

    const result = await getPresignedUploadUrl(request);

    sinon.assert.calledOnce(logErrorStub);
    assert.strictEqual(result, undefined);
  });
});
