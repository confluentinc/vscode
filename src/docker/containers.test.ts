import * as assert from "assert";
import * as sinon from "sinon";
import * as dockerClients from "../clients/docker";
import { MANAGED_CONTAINER_LABEL } from "./constants";
import {
  createContainer,
  getContainer,
  getContainersForImage,
  startContainer,
  stopContainer,
  waitForServiceHealthCheck,
} from "./containers";
import * as dockerImages from "./images";

describe("docker/containers.ts ContainerApi wrappers", () => {
  let sandbox: sinon.SinonSandbox;

  // docker/images.ts stubs
  let imageExistsStub: sinon.SinonStub;
  let pullImageStub: sinon.SinonStub;

  // Docker ContainerApi service class stubs
  let containerListStub: sinon.SinonStub;
  let containerCreateStub: sinon.SinonStub;
  let containerStartStub: sinon.SinonStub;
  let containerStopStub: sinon.SinonStub;
  let containerInspectStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    imageExistsStub = sandbox.stub(dockerImages, "imageExists");
    pullImageStub = sandbox.stub(dockerImages, "pullImage");

    // need to stub the ContainerApi class methods directly instead of using a stubbed instance,
    // because the functions below are constructing new instances of the ContainerApi class each time
    // and if we stubbed the instance, the stubs would not be applied to the new instances and the
    // tests would try to call the real methods
    containerListStub = sandbox.stub(dockerClients.ContainerApi.prototype, "containerList");
    containerCreateStub = sandbox.stub(dockerClients.ContainerApi.prototype, "containerCreate");
    containerStartStub = sandbox.stub(dockerClients.ContainerApi.prototype, "containerStart");
    containerStopStub = sandbox.stub(dockerClients.ContainerApi.prototype, "containerStop");
    containerInspectStub = sandbox.stub(dockerClients.ContainerApi.prototype, "containerInspect");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("getContainersForImage() should return an array of ContainerSummary after successfully listing containers", async () => {
    const fakeResponse: dockerClients.ContainerSummary[] = [{ Id: "1", Names: ["container1"] }];
    containerListStub.resolves(fakeResponse);

    const result = await getContainersForImage({});

    assert.deepStrictEqual(result, fakeResponse);
    assert.ok(containerListStub.calledOnce);
  });

  it("getContainersForImage() should re-throw any error from .containerList", async () => {
    const fakeError = new Error("Error listing containers");
    containerListStub.rejects(fakeError);

    await assert.rejects(getContainersForImage({}), fakeError);
    assert.ok(containerListStub.calledOnce);
  });

  it("createContainer() should return a ContainerCreateResponse after successfully creating a container", async () => {
    imageExistsStub.resolves(true);
    const fakeResponse: dockerClients.ContainerCreateResponse = { Id: "1", Warnings: [] };
    containerCreateStub.resolves(fakeResponse);

    const result = await createContainer("repo", "tag", { body: {} });

    assert.deepStrictEqual(result, fakeResponse);
    assert.ok(containerCreateStub.calledOnce);
  });

  // TODO: determine if we want to keep this behavior+test
  it("createContainer() should pull image if it doesn't exist, then create the container", async () => {
    imageExistsStub.resolves(false);
    pullImageStub.resolves();
    const fakeResponse: dockerClients.ContainerCreateResponse = { Id: "1", Warnings: [] };
    containerCreateStub.resolves(fakeResponse);

    const result = await createContainer("repo", "tag", { body: {} });

    assert.deepStrictEqual(result, fakeResponse);
    assert.ok(imageExistsStub.calledOnce);
    assert.ok(pullImageStub.calledOnce);
    assert.ok(containerCreateStub.calledOnce);
  });

  it(`createContainer() should always add the "${MANAGED_CONTAINER_LABEL}" label to .containerCreate calls`, async () => {
    imageExistsStub.resolves(true);
    const fakeResponse: dockerClients.ContainerCreateResponse = { Id: "1", Warnings: [] };
    containerCreateStub.resolves(fakeResponse);

    await createContainer("repo", "tag", { body: {} });

    assert.ok(containerCreateStub.calledOnce);
    assert.ok(
      containerCreateStub.calledWithMatch({
        body: {
          Labels: {
            [MANAGED_CONTAINER_LABEL]: "true",
          },
        },
      }),
    );
  });

  it("createContainer() should re-throw any error from .containerCreate", async () => {
    imageExistsStub.resolves(true);
    const fakeError = new Error("Error creating container");
    containerCreateStub.rejects(fakeError);

    await assert.rejects(createContainer("repo", "tag", { body: {} }), fakeError);
    assert.ok(containerCreateStub.calledOnce);
  });

  it("startContainer() should return nothing after successfully starting a container", async () => {
    containerStartStub.resolves();

    const result = await startContainer("1");

    assert.strictEqual(result, undefined);
    assert.ok(containerStartStub.calledOnce);
  });

  it("startContainer() should re-throw any error from .containerStart", async () => {
    const fakeError = new Error("Error starting container");
    containerStartStub.rejects(fakeError);

    await assert.rejects(startContainer("1"), fakeError);
    assert.ok(containerStartStub.calledOnce);
  });

  it("getContainer() should return a ContainerInspectResponse from a successful request", async () => {
    const fakeResponse: dockerClients.ContainerInspectResponse = { Id: "1" };
    containerInspectStub.resolves(fakeResponse);

    const result = await getContainer("1");

    assert.deepStrictEqual(result, fakeResponse);
    assert.ok(containerInspectStub.calledOnce);
  });

  it("stopContainer() should return nothing after successfully stopping a container", async () => {
    containerStopStub.resolves();

    const result = await stopContainer("1");

    assert.strictEqual(result, undefined);
    assert.ok(containerStopStub.calledOnce);
  });

  it("stopContainer() should re-throw any error from .containerStop", async () => {
    const fakeError = new Error("Error stopping container");
    containerStopStub.rejects(fakeError);

    await assert.rejects(stopContainer("1"), fakeError);
    assert.ok(containerStopStub.calledOnce);
  });

  it("getContainer() should re-throw any error from .containerInspect", async () => {
    const fakeError = new Error("Error inspecting container");
    containerInspectStub.rejects(fakeError);

    await assert.rejects(getContainer("1"), fakeError);
    assert.ok(containerInspectStub.calledOnce);
  });
});

describe("docker/containers.ts waitForServiceHealthCheck", () => {
  let sandbox: sinon.SinonSandbox;
  let fetchStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    fetchStub = sandbox.stub(globalThis, "fetch");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should return true when service health check succeeds", async () => {
    fetchStub.resolves({ ok: true, status: 200 });

    const result = await waitForServiceHealthCheck("9090", "/health", "TestService");

    assert.strictEqual(result, true);
    assert.ok(fetchStub.calledWith("http://localhost:9090/health"));
  });

  it("should return false when health check fails consistently", async () => {
    fetchStub.rejects(new Error("Connection refused"));

    const result = await waitForServiceHealthCheck("9090", "/health", "TestService", 3);

    assert.strictEqual(result, false);
    assert.ok(fetchStub.called);
  });

  it("should return false when service returns non-ok status", async () => {
    fetchStub.resolves({ ok: false, status: 503 });

    const result = await waitForServiceHealthCheck("9090", "/health", "TestService", 3);

    assert.strictEqual(result, false);
    assert.ok(fetchStub.called);
  });

  it("should retry failed requests and eventually succeed", async () => {
    // First call fails, second call succeeds
    fetchStub.onFirstCall().rejects(new Error("Connection refused"));
    fetchStub.onSecondCall().resolves({ ok: true, status: 200 });

    const result = await waitForServiceHealthCheck("9090", "/health", "TestService", 5);

    assert.strictEqual(result, true);
    assert.strictEqual(fetchStub.callCount, 2);
  });
});
