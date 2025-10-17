import * as assert from "assert";
import sinon from "sinon";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import type { ApiResponse, EventMessage } from "../clients/docker";
import {
  ContainerApi,
  ContainerStateStatusEnum,
  EventMessageTypeEnum,
  SystemApi,
} from "../clients/docker";
import * as contextValues from "../context/values";
import {
  dockerServiceAvailable,
  localKafkaConnected,
  localSchemaRegistryConnected,
} from "../emitters";
import { LOCAL_KAFKA_IMAGE } from "../extensionSettings/constants";
import * as localConnections from "../sidecar/connections/local";
import * as configs from "./configs";
import type { SystemEventMessage } from "./eventListener";
import { EventListener } from "./eventListener";

const TEST_CONTAINER_EVENT: SystemEventMessage = {
  id: "test-id",
  Type: EventMessageTypeEnum.Container,
  Actor: { Attributes: { image: LOCAL_KAFKA_IMAGE.defaultValue } },
};

describe("docker/eventListener.ts EventListener methods", function () {
  let sandbox: sinon.SinonSandbox;
  let clock: sinon.SinonFakeTimers;
  let eventListener: EventListener;

  before(async function () {
    await getTestExtensionContext();

    // Stop any running instance of the event listener before starting tests to minimize hilarious interference.
    const existingInstance = EventListener.getInstance();
    existingInstance.stop();
  });

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    // IMPORTANT: we need to use the fake timers here so we can control the timing of the event listener
    // logic against the timing of the assertions and the Docker API stubs. The main reasoning here
    // is we're using a polling mechanism to check for events, and we want to be able to advance the
    // clock in a controlled way to ensure that the polling logic executes as expected
    clock = sandbox.useFakeTimers(Date.now());
    // stub defaultRequestInit() so we don't try to load Docker credentials or the socket path
    sandbox.stub(configs, "defaultRequestInit").resolves({});
    eventListener = EventListener.getInstance();
  });

  afterEach(function () {
    // reset the singleton instance so we can re-instantiate it with fresh properties between tests
    eventListener.stop();
    EventListener["instance"] = null;
    sandbox.restore();
  });

  it("start() should start the poller", function () {
    const pollStartSpy = sandbox.spy(eventListener["poller"], "start");

    eventListener.start();

    assert.strictEqual(eventListener["stopped"], false);
    sinon.assert.calledOnce(pollStartSpy);
  });

  it("stop() should stop the poller", function () {
    const pollStopSpy = sandbox.spy(eventListener["poller"], "stop");

    eventListener.stop();

    assert.strictEqual(eventListener["stopped"], true);
    sinon.assert.calledOnce(pollStopSpy);
  });

  it("listenForEvents() should exit early if already handling the event stream", async function () {
    eventListener["handlingEventStream"] = true;

    const isDockerAvailableStub = sandbox.stub(configs, "isDockerAvailable").resolves(true);
    await eventListener.listenForEvents();

    // should not have called isDockerAvailable() since we exited early
    sinon.assert.notCalled(isDockerAvailableStub);
  });

  it("listenForEvents() should poll slowly if Docker is not available", async function () {
    this.retries(2); // retry this test up to 2 times if it fails

    const dockerAvailable = false;

    // Make it as if we previously thought that Docker was available
    const getContextValueStub = sandbox.stub(contextValues, "getContextValue");
    getContextValueStub.withArgs(contextValues.ContextValues.dockerServiceAvailable).returns(true);

    const setContextValueStub = sandbox.stub(contextValues, "setContextValue").resolves();

    const dockerServiceAvailableFireStub = sandbox.stub(dockerServiceAvailable, "fire");

    // stub the isDockerAvailable method so we don't actually check for Docker availability
    const isDockerAvailableStub = sandbox
      .stub(configs, "isDockerAvailable")
      .resolves(dockerAvailable);
    // spy the useSlowFrequency and useFastFrequency methods so we can assert that they're called correctly
    const useSlowFrequencySpy = sandbox.spy(eventListener["poller"], "useSlowFrequency");
    const useFastFrequencySpy = sandbox.spy(eventListener["poller"], "useFastFrequency");
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
    // stub readValuesFromStream() and handleEvent() even though we should never reach them
    const readValuesFromStreamStub = sandbox.stub(eventListener, "readValuesFromStream").returns(
      (async function* () {
        yield JSON.stringify(TEST_CONTAINER_EVENT);
      })(),
    );
    const handleEventStub = sandbox.stub(eventListener, "handleEvent").resolves();

    // start the poller, which calls into `listenForEvents()` immediately
    eventListener.start();
    // advance the clock to allow the event listener logic to execute
    await clock.tickAsync(100);

    // we should have called these, then bailed until the next poll
    sinon.assert.calledOnceWithExactly(
      getContextValueStub,
      contextValues.ContextValues.dockerServiceAvailable,
    );

    sinon.assert.calledOnceWithExactly(
      setContextValueStub,
      contextValues.ContextValues.dockerServiceAvailable,
      false,
    );

    sinon.assert.calledOnceWithExactly(dockerServiceAvailableFireStub, false);

    sinon.assert.calledOnce(isDockerAvailableStub);
    assert.equal(eventListener.dockerAvailable, dockerAvailable);
    sinon.assert.calledOnce(useSlowFrequencySpy);
    // and we shouldn't have reached any of these
    sinon.assert.notCalled(useFastFrequencySpy);
    sinon.assert.notCalled(systemEventsRawStub);
    sinon.assert.notCalled(readValuesFromStreamStub);
    sinon.assert.notCalled(handleEventStub);
  });

  it("listenForEvents() should poll more frequently and make a request for system events if Docker is available", async function () {
    this.retries(2); // retry this test up to 2 times if it fails

    const dockerAvailable = true;
    // stub the isDockerAvailable method so we don't actually check for Docker availability
    const isDockerAvailableStub = sandbox
      .stub(configs, "isDockerAvailable")
      .resolves(dockerAvailable);
    // spy the useSlowFrequency and useFastFrequency methods so we can assert that they're called correctly
    const useSlowFrequencySpy = sandbox.spy(eventListener["poller"], "useSlowFrequency");
    const useFastFrequencySpy = sandbox.spy(eventListener["poller"], "useFastFrequency");
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
    // stub the readValuesFromStream method to yield a test event
    const readValuesFromStreamStub = sandbox.stub(eventListener, "readValuesFromStream").returns(
      (async function* () {
        yield JSON.stringify(TEST_CONTAINER_EVENT);
      })(),
    );
    // don't actually go into the handleEvent() logic for this test
    const handleEventStub = sandbox.stub(eventListener, "handleEvent").resolves();

    // start the poller, which calls into `listenForEvents()` immediately
    eventListener.start();
    // advance the clock to allow the event listener logic to execute
    await clock.tickAsync(100);

    sinon.assert.calledOnce(isDockerAvailableStub);
    assert.equal(eventListener.dockerAvailable, dockerAvailable);
    sinon.assert.notCalled(useSlowFrequencySpy);
    sinon.assert.calledOnce(useFastFrequencySpy);
    sinon.assert.calledOnce(systemEventsRawStub);
    sinon.assert.calledOnceWithExactly(readValuesFromStreamStub, stream);
    sinon.assert.calledOnceWithExactly(handleEventStub, TEST_CONTAINER_EVENT);
  });

  it("listenForEvents() should update context values and fire events if the connection to Docker is lost and an error with cause 'other side closed' is thrown while reading from the event stream", async function () {
    this.retries(2); // retry this test up to 2 times if it fails

    const dockerAvailable = true;
    // stub the isDockerAvailable method so we don't actually check for Docker availability
    const isDockerAvailableStub = sandbox
      .stub(configs, "isDockerAvailable")
      .resolves(dockerAvailable);
    // spy the useSlowFrequency and useFastFrequency methods so we can assert that they're called correctly
    const useSlowFrequencySpy = sandbox.spy(eventListener["poller"], "useSlowFrequency");
    const useFastFrequencySpy = sandbox.spy(eventListener["poller"], "useFastFrequency");
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
    // stub the readValuesFromStream method to yield a test event and then throw an error
    const readValuesFromStreamStub = sandbox.stub(eventListener, "readValuesFromStream").returns(
      (async function* () {
        yield JSON.stringify(TEST_CONTAINER_EVENT);
        const disconnectedError = new TypeError("terminated");
        disconnectedError.cause = new Error("other side closed");
        throw disconnectedError;
      })(),
    );
    // don't actually go into the handleEvent() logic for this test
    const handleEventStub = sandbox.stub(eventListener, "handleEvent").resolves();
    // stub the setContextValue and localKafkaConnected.fire methods so we can assert that they're called
    const setContextValueStub = sandbox.stub(contextValues, "setContextValue").resolves();
    const localKafkaConnectedFireStub = sandbox.stub(localKafkaConnected, "fire");
    const dockerServiceAvailableFireStub = sandbox.stub(dockerServiceAvailable, "fire");
    const localSchemaRegistryConnectedFireStub = sandbox.stub(localSchemaRegistryConnected, "fire");

    // start the poller, which calls into `listenForEvents()` immediately
    eventListener.start();
    // advance the clock to allow the event listener logic to execute
    await clock.tickAsync(100);

    sinon.assert.calledOnce(isDockerAvailableStub);
    assert.equal(eventListener.dockerAvailable, dockerAvailable);
    sinon.assert.notCalled(useSlowFrequencySpy);
    sinon.assert.calledOnce(useFastFrequencySpy);
    sinon.assert.calledOnce(systemEventsRawStub);
    sinon.assert.calledOnceWithExactly(readValuesFromStreamStub, stream);
    sinon.assert.calledOnceWithExactly(handleEventStub, TEST_CONTAINER_EVENT);
    for (const contextValue of [
      contextValues.ContextValues.localKafkaClusterAvailable,
      contextValues.ContextValues.dockerServiceAvailable,
      contextValues.ContextValues.localSchemaRegistryAvailable,
    ]) {
      sinon.assert.calledWith(setContextValueStub, contextValue, false);
    }

    for (const emitterFireStub of [
      dockerServiceAvailableFireStub,
      localKafkaConnectedFireStub,
      localSchemaRegistryConnectedFireStub,
    ]) {
      sinon.assert.calledOnceWithExactly(emitterFireStub, false);
    }
  });

  it("readValuesFromStream() should successfully read a value from a ReadableStream before yielding", async function () {
    const stream: ReadableStream<Uint8Array> = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify(TEST_CONTAINER_EVENT)));
        controller.close();
      },
    });

    const events = [];
    for await (const event of eventListener.readValuesFromStream(stream)) {
      events.push(event);
    }

    assert.deepStrictEqual(events, [JSON.stringify(TEST_CONTAINER_EVENT)]);
  });

  it("readValuesFromStream() should exit early if the stream returns 'done'", async function () {
    const handleEventStub = sandbox.stub(eventListener, "handleEvent").resolves();

    const stream: ReadableStream<Uint8Array> = new ReadableStream({
      start(controller) {
        controller.close();
      },
    });
    await eventListener.readValuesFromStream(stream);

    sinon.assert.notCalled(handleEventStub);
  });

  it("readValuesFromStream() should exit early if the event listener is stopped", async function () {
    // since we aren't starting the poller, we're just working with the `stopped` flag here
    eventListener.stop();

    const stream: ReadableStream<Uint8Array> = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify(TEST_CONTAINER_EVENT)));
        controller.close();
      },
    });

    const events = [];
    for await (const event of eventListener.readValuesFromStream(stream)) {
      events.push(event);
    }

    assert.deepStrictEqual(events, []);
  });

  it("readValuesFromStream() should exit early if no value is available", async function () {
    const stream: ReadableStream<Uint8Array> = new ReadableStream({
      start(controller) {
        // no controller.enqueue() here
        controller.close();
      },
    });
    const events = [];
    for await (const event of eventListener.readValuesFromStream(stream)) {
      events.push(event);
    }

    assert.deepStrictEqual(events, []);
  });

  it("readValuesFromStream() should properly split and yield multiple values from a ReadableStream", async function () {
    const stream: ReadableStream<Uint8Array> = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify(TEST_CONTAINER_EVENT)));
        controller.enqueue(new TextEncoder().encode(JSON.stringify(TEST_CONTAINER_EVENT)));
        // and an empty string to ensure it isn't yielded
        controller.enqueue(new TextEncoder().encode(""));
        controller.close();
      },
    });

    const events = [];
    for await (const event of eventListener.readValuesFromStream(stream)) {
      events.push(event);
    }

    assert.deepStrictEqual(events, [
      JSON.stringify(TEST_CONTAINER_EVENT),
      JSON.stringify(TEST_CONTAINER_EVENT),
    ]);
  });

  it("handleEvent() should handle a container event", async function () {
    const handleContainerEventStub = sandbox.stub(eventListener, "handleContainerEvent").resolves();

    const eventWithStatus: SystemEventMessage = {
      ...TEST_CONTAINER_EVENT,
      status: "foo",
    };
    await eventListener.handleEvent(eventWithStatus);

    sinon.assert.calledOnceWithExactly(handleContainerEventStub, eventWithStatus);
  });

  it("handleEvent() should exit early if the event is missing 'status'", async function () {
    const handleContainerEventStub = sandbox.stub(eventListener, "handleContainerEvent").resolves();

    const missingStatusEvent: SystemEventMessage = {
      ...TEST_CONTAINER_EVENT,
      status: undefined,
    };
    await eventListener.handleEvent(missingStatusEvent);

    sinon.assert.notCalled(handleContainerEventStub);
  });

  it("handleEvent() should exit early if the event is not a container event", async function () {
    const handleContainerEventStub = sandbox.stub(eventListener, "handleContainerEvent").resolves();

    const imageEvent: SystemEventMessage = {
      ...TEST_CONTAINER_EVENT,
      Type: EventMessageTypeEnum.Image,
    };
    await eventListener.handleEvent(imageEvent);

    sinon.assert.notCalled(handleContainerEventStub);
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

    sinon.assert.calledOnceWithExactly(handleContainerStartEventStub, startEvent);
    sinon.assert.notCalled(handleContainerDieEventStub);
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

    sinon.assert.notCalled(handleContainerStartEventStub);
    sinon.assert.calledOnceWithExactly(handleContainerDieEventStub, dieEvent);
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

    sinon.assert.notCalled(handleContainerStartEventStub);
    sinon.assert.notCalled(handleContainerDieEventStub);
  });

  it("handleContainerStartEvent() should set the 'localKafkaClusterAvailable' context value and cause the 'localKafkaConnected' event emitter to fire if a container from the 'confluent-local' image starts successfully", async function () {
    // stub the waitForContainerState and waitForContainerLog methods so we don't actually wait for them to resolve
    const waitForContainerRunningStub = sandbox
      .stub(eventListener, "waitForContainerState")
      .resolves(true);
    const waitForServerStartedLogStub = sandbox
      .stub(eventListener, "waitForContainerLog")
      .resolves(true);
    // stub the setContextValue and localKafkaConnected.fire methods so we can assert that they're called
    const setContextValueStub = sandbox.stub(contextValues, "setContextValue").resolves();
    const localKafkaConnectedFireStub = sandbox.stub(localKafkaConnected, "fire");
    // stub updateLocalConnection since we don't care about the actual connection update for this test
    sandbox.stub(localConnections, "updateLocalConnection").resolves();

    await eventListener.handleContainerStartEvent(TEST_CONTAINER_EVENT);

    sinon.assert.calledOnce(waitForContainerRunningStub);
    sinon.assert.calledOnce(waitForServerStartedLogStub);
    sinon.assert.calledOnceWithExactly(
      setContextValueStub,
      contextValues.ContextValues.localKafkaClusterAvailable,
      true,
    );
    sinon.assert.calledOnceWithExactly(localKafkaConnectedFireStub, true);
  });

  it("handleContainerStartEvent() should exit early for containers from non-'confluent-local' images", async function () {
    // stub the waitForContainerState and waitForContainerLog methods so we don't actually wait for them to resolve
    const waitForContainerRunningStub = sandbox
      .stub(eventListener, "waitForContainerState")
      .resolves(true);
    const waitForServerStartedLogStub = sandbox
      .stub(eventListener, "waitForContainerLog")
      .resolves(true);
    const setContextValueStub = sandbox.stub(contextValues, "setContextValue").resolves();
    const localKafkaConnectedFireStub = sandbox.stub(localKafkaConnected, "fire");

    // considering we're filtering for the 'confluent-local' image in the request to systemEventsRaw(),
    // this should never actually happen, but we'll test it anyway
    await eventListener.handleContainerStartEvent({
      ...TEST_CONTAINER_EVENT,
      Actor: { Attributes: { image: "not-confluent-local" } },
    });

    sinon.assert.notCalled(waitForContainerRunningStub);
    sinon.assert.notCalled(waitForServerStartedLogStub);
    sinon.assert.notCalled(setContextValueStub);
    sinon.assert.notCalled(localKafkaConnectedFireStub);
  });

  it("handleContainerStartEvent() should exit early if the event is missing an id or image name", async function () {
    // stub the waitForContainerState and waitForContainerLog methods even though we should never reach them
    const waitForContainerRunningStub = sandbox
      .stub(eventListener, "waitForContainerState")
      .resolves(true);
    const waitForServerStartedLogStub = sandbox
      .stub(eventListener, "waitForContainerLog")
      .resolves(true);
    const setContextValueStub = sandbox.stub(contextValues, "setContextValue").resolves();
    const localKafkaConnectedFireStub = sandbox.stub(localKafkaConnected, "fire");

    await eventListener.handleContainerStartEvent({ ...TEST_CONTAINER_EVENT, id: undefined });

    sinon.assert.notCalled(waitForContainerRunningStub);
    sinon.assert.notCalled(waitForServerStartedLogStub);
    sinon.assert.notCalled(setContextValueStub);
    sinon.assert.notCalled(localKafkaConnectedFireStub);
  });

  it("handleContainerDieEvent() should set the 'localKafkaClusterAvailable' context value and cause the 'localKafkaConnected' event emitter to fire if a container from the 'confluent-local' image dies", async function () {
    const event: SystemEventMessage = {
      ...TEST_CONTAINER_EVENT,
      status: "die",
    };
    const setContextValueStub = sandbox.stub(contextValues, "setContextValue").resolves();
    const localKafkaConnectedFireStub = sandbox.stub(localKafkaConnected, "fire");

    await eventListener.handleContainerDieEvent(event);

    sinon.assert.calledOnceWithExactly(
      setContextValueStub,
      contextValues.ContextValues.localKafkaClusterAvailable,
      false,
    );
    sinon.assert.calledOnceWithExactly(localKafkaConnectedFireStub, false);
  });

  it("handleContainerDieEvent() should exit early for containers from non-'confluent-local' images", async function () {
    const event: SystemEventMessage = {
      ...TEST_CONTAINER_EVENT,
      status: "die",
      Actor: { Attributes: { image: "not-confluent-local" } },
    };
    const setContextValueStub = sandbox.stub(contextValues, "setContextValue").resolves();
    const localKafkaConnectedFireStub = sandbox.stub(localKafkaConnected, "fire");

    await eventListener.handleContainerDieEvent(event);

    sinon.assert.notCalled(setContextValueStub);
    sinon.assert.notCalled(localKafkaConnectedFireStub);
  });

  it("handleContainerDieEvent() should exit early if the event is missing an image name", async function () {
    const event: SystemEventMessage = {
      ...TEST_CONTAINER_EVENT,
      status: "die",
      Actor: undefined,
    };
    const setContextValueStub = sandbox.stub(contextValues, "setContextValue").resolves();
    const localKafkaConnectedFireStub = sandbox.stub(localKafkaConnected, "fire");

    await eventListener.handleContainerDieEvent(event);

    sinon.assert.notCalled(setContextValueStub);
    sinon.assert.notCalled(localKafkaConnectedFireStub);
  });

  it("matchContainerStatus() should return true if the container status is matched", async function () {
    const containerStateStatus: ContainerStateStatusEnum = ContainerStateStatusEnum.Running;

    const containerInspectStub = sandbox.stub(ContainerApi.prototype, "containerInspect").resolves({
      State: { Status: containerStateStatus },
    });

    const containerId: string = TEST_CONTAINER_EVENT.id!;
    const result: boolean = await eventListener.matchContainerStatus(
      containerId,
      containerStateStatus,
    );

    assert.strictEqual(result, true);
    sinon.assert.calledOnceWithMatch(containerInspectStub, { id: containerId });
  });

  it("matchContainerStatus() should return false if the container status is not matched", async function () {
    const containerStateStatus: ContainerStateStatusEnum = ContainerStateStatusEnum.Created;

    const containerInspectStub = sandbox.stub(ContainerApi.prototype, "containerInspect").resolves({
      State: { Status: containerStateStatus },
    });

    const containerId = TEST_CONTAINER_EVENT.id!;
    const result: boolean = await eventListener.matchContainerStatus(
      containerId,
      ContainerStateStatusEnum.Running,
    );

    assert.strictEqual(result, false);
    sinon.assert.calledOnceWithMatch(containerInspectStub, { id: containerId });
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
    sinon.assert.calledOnceWithMatch(containerLogsRawStub, {
      id,
      since,
      follow: true,
      stdout: true,
    });
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
    sinon.assert.calledOnce(containerLogsRawStub);
    sinon.assert.calledOnceWithMatch(containerLogsRawStub, {
      id,
      since,
      follow: true,
      stdout: true,
    });
  });
});
