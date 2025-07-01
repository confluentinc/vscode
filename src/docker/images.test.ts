import * as assert from "assert";
import * as sinon from "sinon";
import { ApiResponse, ImageApi, ImageSummary } from "../clients/docker";
import { imageExists, pullImage } from "./images";

const fakeImageRepo = "repo";
const fakeImageTag = "tag";
const fakeImageRepoTag = `${fakeImageRepo}:${fakeImageTag}`;
const fakeImageSummary: ImageSummary = {
  Id: "sha256:abc123",
  ParentId: "",
  RepoTags: ["example:latest"],
  RepoDigests: [],
  Created: 123,
  Size: 123,
  SharedSize: 123,
  VirtualSize: 123,
  Labels: {},
  Containers: 1,
};

describe("docker/images.ts ImageApi wrappers", () => {
  let sandbox: sinon.SinonSandbox;

  let imageListStub: sinon.SinonStub;
  let imageCreateRawStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // need to stub the ImageApi class methods directly instead of using a stubbed instance,
    // because the functions below are constructing new instances of the ImageApi class each time
    // and if we stubbed the instance, the stubs would not be applied to the new instances and the
    // tests would try to call the real methods
    imageListStub = sandbox.stub(ImageApi.prototype, "imageList").resolves();
    imageCreateRawStub = sandbox.stub(ImageApi.prototype, "imageCreateRaw").resolves();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("imageExists() should return true if the image repo+tag exists in the image listing", async () => {
    const summary = { ...fakeImageSummary, RepoTags: [fakeImageRepoTag] };
    const fakeResponse: ImageSummary[] = [summary];
    imageListStub.resolves(fakeResponse);

    const result = await imageExists(fakeImageRepo, fakeImageTag);

    assert.strictEqual(result, true);
    assert.ok(imageListStub.calledOnce);
  });

  it("imageExists() should return false if the image repo+tag does not exist in the image listing", async () => {
    // don't include repo:tag by default
    const fakeResponse: ImageSummary[] = [fakeImageSummary];
    imageListStub.resolves(fakeResponse);

    const result = await imageExists(fakeImageRepo, fakeImageTag);

    assert.strictEqual(result, false);
    assert.ok(imageListStub.calledOnce);
  });

  it("imageExists() should return false if there is a non-ResponseError error", async () => {
    const fakeError = new Error("Some other error");
    imageListStub.rejects(fakeError);

    const result = await imageExists(fakeImageRepo, fakeImageTag);

    assert.strictEqual(result, false);
    assert.ok(imageListStub.calledOnce);
  });

  it("pullImage() should return nothing after successfully pulling an image", async () => {
    const fakeRawResponse: ApiResponse<void> = {
      raw: new Response("fake body", { status: 200, statusText: "OK" }),
      value() {
        return Promise.resolve(undefined);
      },
    };
    imageCreateRawStub.resolves(fakeRawResponse);

    const result = await pullImage(fakeImageRepo, fakeImageTag);

    assert.strictEqual(result, undefined);
    assert.ok(imageCreateRawStub.calledOnce);
    assert.ok(imageCreateRawStub.calledWithMatch({ fromImage: fakeImageRepoTag }));
  });

  it("pullImage() should re-throw any error from .imageCreate", async () => {
    const fakeError = new Error("Error pulling image");
    imageCreateRawStub.rejects(fakeError);

    await assert.rejects(pullImage(fakeImageRepo, fakeImageTag), fakeError);
    assert.ok(imageCreateRawStub.calledOnce);
  });
});
