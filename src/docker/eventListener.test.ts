import * as assert from "assert";
import sinon from "sinon";
import {
  ApiResponse,
  ContainerApi,
  ContainerStateStatusEnum,
  EventMessage,
  SystemApi,
} from "../clients/docker";
import * as context from "../context";
import { localKafkaConnected } from "../emitters";
import * as configs from "./configs";
import { EventListener, LOCAL_KAFKA_IMAGE, SystemEventMessage } from "./eventListener";

const TEST_CONTAINER_EVENT: SystemEventMessage = {
  id: "test-id",
  Type: "container",
  Actor: { Attributes: { image: LOCAL_KAFKA_IMAGE } },
};

describe("docker/eventListener EventListener methods", function () {
  let sandbox: sinon.SinonSandbox;

  // src/docker/eventListener.ts stubs/spies
  let eventListener: EventListener;
  let pollStartSpy: sinon.SinonSpy;
  let pollStopSpy: sinon.SinonSpy;
  let useRegularFrequencySpy: sinon.SinonSpy;
  let useHighFrequencySpy: sinon.SinonSpy;

  beforeEach(function () {
    sandbox = sinon.createSandbox();

    eventListener = EventListener.getInstance();
    // spy on the private `poller`'s methods so we can assert their behavior in the tests
    pollStartSpy = sandbox.spy(eventListener["poller"], "start");
    pollStopSpy = sandbox.spy(eventListener["poller"], "stop");
    useRegularFrequencySpy = sandbox.spy(eventListener["poller"], "useRegularFrequency");
    useHighFrequencySpy = sandbox.spy(eventListener["poller"], "useHighFrequency");
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("start() should start the poller", function () {
    eventListener.start();

    assert.strictEqual(eventListener["stopped"], false);
    assert.ok(pollStartSpy.calledOnce);
  });

  it("stop() should stop the poller", function () {
    eventListener.stop();

    assert.strictEqual(eventListener["stopped"], true);
    assert.ok(pollStopSpy.calledOnce);
    // explicitly reset `stopped` so we don't bail early in the event handling in other tests
    // (this doesn't happen in the normal flow since we'll either .start() or .stop() and not have
    // to worry about the listener being stopped and then reinstantiated)
    eventListener["stopped"] = false;
  });

  it("listenForEvents() should poll slowly if Docker is not available", async function () {
    // stub the isDockerAvailable method so we don't actually check for Docker availability
    const isDockerAvailableStub = sandbox.stub(configs, "isDockerAvailable").resolves(false);
    // stub the systemEventsRaw request even though we should never reach it
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify(TEST_CONTAINER_EVENT)));
        controller.close();
      },
    });
    const systemEventsRawStub = sandbox.stub(SystemApi.prototype, "systemEventsRaw").resolves({
      raw: {
        body: stream,
      },
    } as ApiResponse<EventMessage>);
    // stub readEventsFromStream() and handleEvent() even though we should never reach them
    const readEventsFromStreamStub = sandbox.stub(eventListener, "readEventsFromStream").returns(
      (async function* () {
        yield TEST_CONTAINER_EVENT;
      })(),
    );
    const handleEventStub = sandbox.stub(eventListener, "handleEvent").resolves();

    await eventListener.listenForEvents();

    // we should have called these two, then bailed until the next poll
    assert.ok(isDockerAvailableStub.calledOnce);
    assert.ok(useRegularFrequencySpy.calledOnce);
    // and we shouldn't have reached any of these
    assert.ok(useHighFrequencySpy.notCalled);
    assert.ok(pollStopSpy.notCalled);
    assert.ok(systemEventsRawStub.notCalled);
    assert.ok(readEventsFromStreamStub.notCalled);
    assert.ok(handleEventStub.notCalled);
    assert.ok(pollStartSpy.notCalled);
  });

  it("listenForEvents() should poll more frequently and make a request for system events if Docker is available", async function () {
    // stub the isDockerAvailable method so we don't actually check for Docker availability
    const isDockerAvailableStub = sandbox.stub(configs, "isDockerAvailable").resolves(true);
    // stub the systemEventsRaw method so we don't actually make a request
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify(TEST_CONTAINER_EVENT)));
        controller.close();
      },
    });
    const systemEventsRawStub = sandbox.stub(SystemApi.prototype, "systemEventsRaw").resolves({
      raw: {
        body: stream,
      },
    } as ApiResponse<EventMessage>);
    // stub the readEventsFromStream method to yield a test event
    const readEventsFromStreamStub = sandbox.stub(eventListener, "readEventsFromStream").returns(
      (async function* () {
        yield TEST_CONTAINER_EVENT;
      })(),
    );
    // don't actually go into the handleEvent() logic for this test
    const handleEventStub = sandbox.stub(eventListener, "handleEvent").resolves();

    await eventListener.listenForEvents();

    assert.ok(isDockerAvailableStub.calledOnce);
    assert.ok(useRegularFrequencySpy.notCalled);
    assert.ok(useHighFrequencySpy.calledOnce);
    assert.ok(pollStopSpy.calledOnce);
    assert.ok(systemEventsRawStub.calledOnce);
    assert.ok(readEventsFromStreamStub.calledOnceWith(stream));
    assert.ok(handleEventStub.calledOnceWith(TEST_CONTAINER_EVENT));
    assert.ok(pollStartSpy.calledOnce);
  });

  it("readEventsFromStream() should successfully read an event from a ReadableStream before yielding", async function () {
    const stream: ReadableStream<Uint8Array> = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify(TEST_CONTAINER_EVENT)));
        controller.close();
      },
    });

    const events = [];
    for await (const event of eventListener.readEventsFromStream(stream)) {
      events.push(event);
    }

    assert.deepStrictEqual(events, [TEST_CONTAINER_EVENT]);
  });

  it("readEventsFromStream() should exit early if the stream returns 'done'", async function () {
    const handleEventStub = sandbox.stub(eventListener, "handleEvent").resolves();

    const stream: ReadableStream<Uint8Array> = new ReadableStream({
      start(controller) {
        controller.close();
      },
    });
    await eventListener.readEventsFromStream(stream);

    assert.ok(handleEventStub.notCalled);
  });

  it("readEventsFromStream() should exit early if the event listener is stopped", async function () {
    // since we aren't starting the poller, we're just working with the `stopped` flag here
    eventListener.stop();

    const stream: ReadableStream<Uint8Array> = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify(TEST_CONTAINER_EVENT)));
        controller.close();
      },
    });

    const events = [];
    for await (const event of eventListener.readEventsFromStream(stream)) {
      events.push(event);
    }

    assert.deepStrictEqual(events, []);
  });

  it("readEventsFromStream() should exit early if no value is available", async function () {
    const stream: ReadableStream<Uint8Array> = new ReadableStream({
      start(controller) {
        // no controller.enqueue() here
        controller.close();
      },
    });
    const events = [];
    for await (const event of eventListener.readEventsFromStream(stream)) {
      events.push(event);
    }

    assert.deepStrictEqual(events, []);
  });

  it("readEventsFromStream() should exit early in the event of a JSON parsing error", async function () {
    const stream: ReadableStream<Uint8Array> = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("not JSON"));
        controller.close();
      },
    });

    const events = [];
    for await (const event of eventListener.readEventsFromStream(stream)) {
      events.push(event);
    }

    assert.deepStrictEqual(events, []);
  });

  it("handleEvent() should handle a container event", async function () {
    const handleContainerEventStub = sandbox.stub(eventListener, "handleContainerEvent").resolves();

    const eventWithStatus: SystemEventMessage = {
      ...TEST_CONTAINER_EVENT,
      status: "foo",
    };
    await eventListener.handleEvent(eventWithStatus);

    assert.ok(handleContainerEventStub.calledOnceWith(eventWithStatus));
  });

  it("handleEvent() should exit early if the event is missing 'status'", async function () {
    const handleContainerEventStub = sandbox.stub(eventListener, "handleContainerEvent").resolves();

    const missingStatusEvent: SystemEventMessage = {
      ...TEST_CONTAINER_EVENT,
      status: undefined,
    };
    await eventListener.handleEvent(missingStatusEvent);

    assert.ok(handleContainerEventStub.notCalled);
  });

  it("handleEvent() should exit early if the event is not a container event", async function () {
    const handleContainerEventStub = sandbox.stub(eventListener, "handleContainerEvent").resolves();

    const imageEvent: SystemEventMessage = {
      ...TEST_CONTAINER_EVENT,
      Type: "image",
    };
    await eventListener.handleEvent(imageEvent);

    assert.ok(handleContainerEventStub.notCalled);
  });

  it("handleContainerEvent() should pass a container 'start' event to handleContainerStartEvent()", async function () {
    const handleContainerStartEventStub = sandbox
      .stub(eventListener, "handleContainerStartEvent")
      .resolves();
    const handleContainerDieEventStub = sandbox
      .stub(eventListener, "handleContainerDieEvent")
      .resolves();

    const startEvent = {
      ...TEST_CONTAINER_EVENT,
      status: "start",
    };
    await eventListener.handleContainerEvent(startEvent);

    assert.ok(handleContainerStartEventStub.calledOnceWith(startEvent));
    assert.ok(handleContainerDieEventStub.notCalled);
  });

  it("handleContainerEvent() should pass a container 'die' event to handleContainerDieEvent()", async function () {
    const handleContainerStartEventStub = sandbox
      .stub(eventListener, "handleContainerStartEvent")
      .resolves();
    const handleContainerDieEventStub = sandbox
      .stub(eventListener, "handleContainerDieEvent")
      .resolves();

    const dieEvent: SystemEventMessage = {
      ...TEST_CONTAINER_EVENT,
      status: "die",
    };
    await eventListener.handleEvent(dieEvent);

    assert.ok(handleContainerStartEventStub.notCalled);
    assert.ok(handleContainerDieEventStub.calledOnceWith(dieEvent));
  });

  it("handleContainerEvent() should exit early if 'status' is something other than 'start' or 'die'", async function () {
    const handleContainerStartEventStub = sandbox
      .stub(eventListener, "handleContainerStartEvent")
      .resolves();
    const handleContainerDieEventStub = sandbox
      .stub(eventListener, "handleContainerDieEvent")
      .resolves();

    const event: SystemEventMessage = {
      ...TEST_CONTAINER_EVENT,
      status: "stop",
    };
    await eventListener.handleEvent(event);

    assert.ok(handleContainerStartEventStub.notCalled);
    assert.ok(handleContainerDieEventStub.notCalled);
  });

  it("handleContainerStartEvent() should set the 'localKafkaClusterAvailable' context value and cause the 'localKafkaConnected' event emitter to fire if a container from the 'confluent-local' image starts successfully", async function () {
    // stub the waitForContainerState and waitForContainerLog methods so we don't actually wait for them to resolve
    const waitForContainerRunningStub = sandbox
      .stub(eventListener, "waitForContainerState")
      .resolves(true);
    const waitForServerStartedLogStub = sandbox
      .stub(eventListener, "waitForContainerLog")
      .resolves(true);
    const setContextValueStub = sandbox.stub(context, "setContextValue").resolves();
    const localKafkaConnectedFireStub = sandbox.stub(localKafkaConnected, "fire");

    await eventListener.handleContainerStartEvent(TEST_CONTAINER_EVENT);

    assert.ok(waitForContainerRunningStub.calledOnce);
    assert.ok(waitForServerStartedLogStub.calledOnce);
    assert.ok(
      setContextValueStub.calledOnceWith(context.ContextValues.localKafkaClusterAvailable, true),
    );
    assert.ok(localKafkaConnectedFireStub.calledOnceWith(true));
  });

  it("handleContainerStartEvent() should exit early for containers from non-'confluent-local' images", async function () {
    // stub the waitForContainerState and waitForContainerLog methods so we don't actually wait for them to resolve
    const waitForContainerRunningStub = sandbox
      .stub(eventListener, "waitForContainerState")
      .resolves(true);
    const waitForServerStartedLogStub = sandbox
      .stub(eventListener, "waitForContainerLog")
      .resolves(true);
    const setContextValueStub = sandbox.stub(context, "setContextValue").resolves();
    const localKafkaConnectedFireStub = sandbox.stub(localKafkaConnected, "fire");

    // considering we're filtering for the 'confluent-local' image in the request to systemEventsRaw(),
    // this should never actually happen, but we'll test it anyway
    await eventListener.handleContainerStartEvent({
      ...TEST_CONTAINER_EVENT,
      Actor: { Attributes: { image: "not-confluent-local" } },
    });

    assert.ok(waitForContainerRunningStub.notCalled);
    assert.ok(waitForServerStartedLogStub.notCalled);
    assert.ok(setContextValueStub.notCalled);
    assert.ok(localKafkaConnectedFireStub.notCalled);
  });

  it("handleContainerStartEvent() should exit early if the event is missing an id or image name", async function () {
    // stub the waitForContainerState and waitForContainerLog methods even though we should never reach them
    const waitForContainerRunningStub = sandbox
      .stub(eventListener, "waitForContainerState")
      .resolves(true);
    const waitForServerStartedLogStub = sandbox
      .stub(eventListener, "waitForContainerLog")
      .resolves(true);
    const setContextValueStub = sandbox.stub(context, "setContextValue").resolves();
    const localKafkaConnectedFireStub = sandbox.stub(localKafkaConnected, "fire");

    await eventListener.handleContainerStartEvent({ ...TEST_CONTAINER_EVENT, id: undefined });

    assert.ok(waitForContainerRunningStub.notCalled);
    assert.ok(waitForServerStartedLogStub.notCalled);
    assert.ok(setContextValueStub.notCalled);
    assert.ok(localKafkaConnectedFireStub.notCalled);
  });

  it("handleContainerDieEvent() should set the 'localKafkaClusterAvailable' context value and cause the 'localKafkaConnected' event emitter to fire if a container from the 'confluent-local' image dies", async function () {
    const event: SystemEventMessage = {
      ...TEST_CONTAINER_EVENT,
      status: "die",
    };
    const setContextValueStub = sandbox.stub(context, "setContextValue").resolves();
    const localKafkaConnectedFireStub = sandbox.stub(localKafkaConnected, "fire");

    await eventListener.handleContainerDieEvent(event);

    assert.ok(
      setContextValueStub.calledOnceWith(context.ContextValues.localKafkaClusterAvailable, false),
    );
    assert.ok(localKafkaConnectedFireStub.calledOnceWith(false));
  });

  it("handleContainerDieEvent() should exit early for containers from non-'confluent-local' images", async function () {
    const event: SystemEventMessage = {
      ...TEST_CONTAINER_EVENT,
      status: "die",
      Actor: { Attributes: { image: "not-confluent-local" } },
    };
    const setContextValueStub = sandbox.stub(context, "setContextValue").resolves();
    const localKafkaConnectedFireStub = sandbox.stub(localKafkaConnected, "fire");

    await eventListener.handleContainerDieEvent(event);

    assert.ok(setContextValueStub.notCalled);
    assert.ok(localKafkaConnectedFireStub.notCalled);
  });

  it("handleContainerDieEvent() should exit early if the event is missing an image name", async function () {
    const event: SystemEventMessage = {
      ...TEST_CONTAINER_EVENT,
      status: "die",
      Actor: undefined,
    };
    const setContextValueStub = sandbox.stub(context, "setContextValue").resolves();
    const localKafkaConnectedFireStub = sandbox.stub(localKafkaConnected, "fire");

    await eventListener.handleContainerDieEvent(event);

    assert.ok(setContextValueStub.notCalled);
    assert.ok(localKafkaConnectedFireStub.notCalled);
  });

  it("matchContainerStatus() should return true if the container status is matched", async function () {
    const containerStateStatus: ContainerStateStatusEnum = "running";

    const containerInspectStub = sandbox.stub(ContainerApi.prototype, "containerInspect").resolves({
      State: { Status: containerStateStatus },
    });

    const containerId: string = TEST_CONTAINER_EVENT.id!;
    const result: boolean = await eventListener.matchContainerStatus(
      containerId,
      containerStateStatus,
    );

    assert.strictEqual(result, true);
    assert.ok(containerInspectStub.calledOnceWith({ id: containerId }));
  });

  it("matchContainerStatus() should return false if the container status is not matched", async function () {
    const containerStateStatus: ContainerStateStatusEnum = "created";

    const containerInspectStub = sandbox.stub(ContainerApi.prototype, "containerInspect").resolves({
      State: { Status: containerStateStatus },
    });

    const containerId = TEST_CONTAINER_EVENT.id!;
    const result: boolean = await eventListener.matchContainerStatus(containerId, "running");

    assert.strictEqual(result, false);
    assert.ok(containerInspectStub.calledOnceWith({ id: containerId }));
  });

  it("waitForContainerLog() should return true if the container logs contain the expected string", async function () {
    const stringToMatch = "expected string";

    const containerLogsRawStub = sandbox.stub(ContainerApi.prototype, "containerLogsRaw").resolves({
      raw: {
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(stringToMatch));
            controller.close();
          },
        }),
      },
    } as ApiResponse<Blob>);

    const id = TEST_CONTAINER_EVENT.id!;
    const since = Date.now();
    const result: boolean = await eventListener.waitForContainerLog(id, stringToMatch, Date.now());

    assert.strictEqual(result, true);
    assert.ok(containerLogsRawStub.calledOnceWith({ id, since, follow: true, stdout: true }));
  });

  it("waitForContainerLog() should return false if the container logs do not contain the expected string", async function () {
    const stringToMatch = "expected string";

    const containerLogsRawStub = sandbox.stub(ContainerApi.prototype, "containerLogsRaw").resolves({
      raw: {
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("some other log"));
            controller.close();
          },
        }),
      },
    } as ApiResponse<Blob>);

    const id = TEST_CONTAINER_EVENT.id!;
    const since = Date.now();
    const result: boolean = await eventListener.waitForContainerLog(id, stringToMatch, since);

    assert.strictEqual(result, false);
    assert.ok(containerLogsRawStub.calledOnce);
    assert.ok(containerLogsRawStub.calledOnceWith({ id, since, follow: true, stdout: true }));
  });
});
