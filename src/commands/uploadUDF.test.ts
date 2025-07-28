import * as assert from "assert";
import * as sinon from "sinon";
import type { PresignedUploadUrlArtifactV1PresignedUrlRequest } from "../clients/flinkArtifacts";
import * as errorsModule from "../errors";
import { EnvironmentId, IEnvProviderRegion } from "../models/resource";
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
      getFlinkArtifactsApi: sandbox.stub().returns(artifactsClientStub),
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
    sinon.assert.calledOnceWithExactly(sidecarHandleStub.getFlinkArtifactsApi, {
      environmentId: request.environment.toString() as EnvironmentId,
      provider: request.cloud,
      region: request.region,
    } as IEnvProviderRegion);
    sinon.assert.calledOnceWithExactly(
      artifactsClientStub.presignedUploadUrlArtifactV1PresignedUrl,
      { PresignedUploadUrlArtifactV1PresignedUrlRequest: request },
    );
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
