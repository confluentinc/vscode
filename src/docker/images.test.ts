import * as assert from "assert";
import * as sinon from "sinon";
import { ImageApi, ImageInspect, ResponseError } from "../clients/docker";
import { imageExists, pullImage } from "./images";

describe.only("docker/images.ts ImageApi wrappers", () => {
  let sandbox: sinon.SinonSandbox;

  let imageInspectStub: sinon.SinonStub;
  let imageCreateStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // need to stub the ImageApi class methods directly instead of using a stubbed instance,
    // because the functions below are constructing new instances of the ImageApi class each time
    // and if we stubbed the instance, the stubs would not be applied to the new instances and the
    // tests would try to call the real methods
    imageInspectStub = sandbox.stub(ImageApi.prototype, "imageInspect");
    imageCreateStub = sandbox.stub(ImageApi.prototype, "imageCreate");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("imageExists() should return true if the image exists", async () => {
    const fakeResponse: ImageInspect = { RepoTags: ["repo:tag"] };
    imageInspectStub.resolves(fakeResponse);

    const result = await imageExists("repo", "tag");

    assert.strictEqual(result, true);
    assert.ok(imageInspectStub.calledOnce);
  });

  it("imageExists() should return false if the image does not exist", async () => {
    const fakeError = new ResponseError(new Response(null, { status: 404 }));
    imageInspectStub.rejects(fakeError);

    const result = await imageExists("repo", "tag");

    assert.strictEqual(result, false);
    assert.ok(imageInspectStub.calledOnce);
  });

  it("imageExists() should return false if there is an error other than 404", async () => {
    const fakeError = new ResponseError(new Response(null, { status: 500 }));
    imageInspectStub.rejects(fakeError);

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
    imageCreateStub.resolves();

    const result = await pullImage("repo", "tag");

    assert.strictEqual(result, undefined);
    assert.ok(imageCreateStub.calledOnce);
    assert.ok(imageCreateStub.calledWithMatch({ fromImage: "repo:tag" }));
  });

  it("pullImage() should re-throw any error from .imageCreate", async () => {
    const fakeError = new Error("Error pulling image");
    imageCreateStub.rejects(fakeError);

    await assert.rejects(pullImage("repo", "tag"), fakeError);
    assert.ok(imageCreateStub.calledOnce);
  });
});
