import * as assert from "assert";
import sinon from "sinon";
import { ApiResponse, ContainerApi, EventMessage, SystemApi } from "../clients/docker";
import * as configs from "./configs";
import * as listener from "./listener";

describe.only("docker.listener", function () {
  let sandbox: sinon.SinonSandbox;

  // src/clients/docker stubs
  let systemApiStub: sinon.SinonStubbedInstance<SystemApi>;
  let containerApiStub: sinon.SinonStubbedInstance<ContainerApi>;

  // configs.ts stubs
  let isDockerAvailableStub: sinon.SinonStub;

  // listener.ts stubs
  let pollStartStub: sinon.SinonStub;
  let pollStopStub: sinon.SinonStub;
  let useRegularFrequencyStub: sinon.SinonStub;
  let useHighFrequencyStub: sinon.SinonStub;
  let readEventStreamStub: sinon.SinonStub;
  let handleEventStub: sinon.SinonStub;

  beforeEach(function () {
    sandbox = sinon.createSandbox();

    // create stubs for the Docker API service classes
    systemApiStub = sandbox.createStubInstance(SystemApi);
    containerApiStub = sandbox.createStubInstance(ContainerApi);

    // ...and poller adjustments
    pollStartStub = sandbox.stub(listener.pollDockerEvents, "start");
    pollStopStub = sandbox.stub(listener.pollDockerEvents, "stop");
    useRegularFrequencyStub = sandbox.stub(listener.pollDockerEvents, "useRegularFrequency");
    useHighFrequencyStub = sandbox.stub(listener.pollDockerEvents, "useHighFrequency");
    // ...and the check for Docker availability
    isDockerAvailableStub = sandbox.stub(configs, "isDockerAvailable");

    // and don't wait for readEventStream() to resolve since that drops tests into infinite loops
    readEventStreamStub = sandbox.stub(listener, "readEventStream").resolves();

    handleEventStub = sandbox.stub(listener, "handleEvent").resolves();
  });

  afterEach(function () {
    sandbox.restore();
  });

  it.only("listenForEvents() should set pollDockerEvents.useRegularFrequency() if Docker is not available", async function () {
    isDockerAvailableStub.resolves(false);
    // no need to stub .systemEventsRaw() since we're not going to call it

    await listener.listenForEvents();

    assert.ok(isDockerAvailableStub.calledOnce);

    assert.ok(useRegularFrequencyStub.called);
    assert.ok(useHighFrequencyStub.notCalled);

    assert.ok(readEventStreamStub.notCalled);
  });

  it.only("listenForEvents() should set pollDockerEvents.useHighFrequency() if Docker is available", async function () {
    isDockerAvailableStub.resolves(true);
    systemApiStub.systemEventsRaw.resolves({
      raw: { body: new ReadableStream() },
    } as ApiResponse<EventMessage>);

    await listener.listenForEvents();

    assert.ok(isDockerAvailableStub.calledOnce);

    assert.ok(useRegularFrequencyStub.notCalled);
    assert.ok(useHighFrequencyStub.called);

    assert.ok(readEventStreamStub.calledOnce);
  });

  it("listenForEvents() should handle errors when getting the event stream", async function () {
    isDockerAvailableStub.resolves(true);
    systemApiStub.systemEventsRaw.rejects(new Error("test error"));

    await listener.listenForEvents();

    assert.ok(isDockerAvailableStub.calledOnce);
    assert.ok(systemApiStub.systemEventsRaw.calledOnce);
  });

  it("listenForEvents() should handle null event stream", async function () {
    isDockerAvailableStub.resolves(true);
    systemApiStub.systemEventsRaw.resolves({ raw: { body: null } } as ApiResponse<EventMessage>);

    await listener.listenForEvents();

    assert.ok(isDockerAvailableStub.calledOnce);
    assert.ok(systemApiStub.systemEventsRaw.calledOnce);
  });

  it("readEventStream() should handle empty event values", async function () {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array());
        controller.close();
      },
    });

    await listener.readEventStream(stream);
    // just ensuring no errors are thrown
  });

  it("readEventFromStream() should handle invalid JSON parsing", async function () {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("invalid json"));
        controller.close();
      },
    });

    await listener.readEventFromStream(stream);
    // just ensuring no errors are thrown
  });

  it("readEventFromStream() should call handleEvent with valid events", async function () {
    const event: listener.CustomEventMessage = {
      status: "start",
      id: "test-id",
      from: "test-from",
      Type: "container",
      Actor: { Attributes: { image: "test-image" } },
      time: Date.now(),
    };
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify(event)));
        controller.close();
      },
    });
    const handleEventStub = sandbox.stub().resolves();

    await listener.readEventStream(stream);

    assert.ok(handleEventStub.calledOnceWith(event));
  });

  it("handleEvent() should handle container start events", async function () {
    const event: listener.CustomEventMessage = {
      status: "start",
      id: "test-id",
      from: "test-from",
      Type: "container",
      Actor: { Attributes: { image: "test-image" } },
      time: Date.now(),
    };
    const handleContainerStartEventStub = sandbox.stub().resolves();

    await listener.handleEvent(event);

    assert.ok(handleContainerStartEventStub.calledOnceWith(event));
  });

  it("handleEvent() should handle container die events", async function () {
    const event: listener.CustomEventMessage = {
      status: "die",
      id: "test-id",
      from: "test-from",
      Type: "container",
      Actor: { Attributes: { image: "test-image" } },
      time: Date.now(),
    };
    const handleContainerDieEventStub = sandbox.stub().resolves();

    await listener.handleEvent(event);

    assert.ok(handleContainerDieEventStub.calledOnceWith(event));
  });
});
