import * as assert from "assert";
import * as sinon from "sinon";
import { ApiResponse, ImageApi, ImageSummary } from "../clients/docker";
import { imageExists, pullImage } from "./images";

describe("docker/images.ts ImageApi wrappers", () => {
  let sandbox: sinon.SinonSandbox;

  let imageInspectStub: sinon.SinonStub;
  let imageCreateRawStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // need to stub the ImageApi class methods directly instead of using a stubbed instance,
    // because the functions below are constructing new instances of the ImageApi class each time
    // and if we stubbed the instance, the stubs would not be applied to the new instances and the
    // tests would try to call the real methods
    imageInspectStub = sandbox.stub(ImageApi.prototype, "imageInspect");
    imageCreateRawStub = sandbox.stub(ImageApi.prototype, "imageCreateRaw");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("imageExists() should return true if the image repo+tag exists in the image listing", async () => {
    const fakeResponse: ImageSummary[] = [
      {
        Id: "sha256:abc123",
        ParentId: "",
        RepoTags: ["repo:tag", "example:latest"],
        RepoDigests: [],
        Created: 123,
        Size: 123,
        SharedSize: 123,
        VirtualSize: 123,
        Labels: {},
        Containers: 1,
      },
    ];
    imageInspectStub.resolves(fakeResponse);

    const result = await imageExists("repo", "tag");

    assert.strictEqual(result, true);
    assert.ok(imageInspectStub.calledOnce);
  });

  it("imageExists() should return false if the image repo+tag does not exist in the image listing", async () => {
    const fakeResponse: ImageSummary[] = [
      {
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
      },
    ];
    imageInspectStub.resolves(fakeResponse);

    const result = await imageExists("repo", "tag");

    assert.strictEqual(result, false);
    assert.ok(imageInspectStub.calledOnce);
  });

  it("imageExists() should return false if there is a non-ResponseError error", async () => {
    const fakeError = new Error("Some other error");
    imageInspectStub.rejects(fakeError);

    const result = await imageExists("repo", "tag");

    assert.strictEqual(result, false);
    assert.ok(imageInspectStub.calledOnce);
  });

  it("pullImage() should return nothing after successfully pulling an image", async () => {
    const fakeRawResponse: ApiResponse<void> = {
      raw: new Response("fake body", { status: 200, statusText: "OK" }),
      value() {
        return Promise.resolve(undefined);
      },
    };
    imageCreateRawStub.resolves(fakeRawResponse);

    const result = await pullImage("repo", "tag");

    assert.strictEqual(result, undefined);
    assert.ok(imageCreateRawStub.calledOnce);
    assert.ok(imageCreateRawStub.calledWithMatch({ fromImage: "repo:tag" }));
  });

  it("pullImage() should re-throw any error from .imageCreate", async () => {
    const fakeError = new Error("Error pulling image");
    imageCreateRawStub.rejects(fakeError);

    await assert.rejects(pullImage("repo", "tag"), fakeError);
    assert.ok(imageCreateRawStub.calledOnce);
  });
});
