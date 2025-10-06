import * as assert from "assert";
import sinon from "sinon";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import {
  ApiResponse,
  ContainerApi,
  ContainerStateStatusEnum,
  EventMessage,
  EventMessageTypeEnum,
  SystemApi,
} from "../clients/docker";
import * as contextValues from "../context/values";
import * as contextValuesModule from "../context/values";
import { localKafkaConnected } from "../emitters";
import { LOCAL_KAFKA_IMAGE } from "../extensionSettings/constants";
import * as localConnections from "../sidecar/connections/local";
import * as configs from "./configs";
import { EventListener, SystemEventMessage } from "./eventListener";

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
    EventListener["instance"] = null;
    sandbox.restore();
  });

  describe("start()", () => {
    it("should start the poller", function () {
      const pollStartSpy = sandbox.spy(eventListener["poller"], "start");

      eventListener.start();

      assert.strictEqual(eventListener["stopped"], false);
      assert.ok(pollStartSpy.calledOnce);
    });
  });

  describe("stop()", () => {
    it("should stop the poller", function () {
      const pollStopSpy = sandbox.spy(eventListener["poller"], "stop");

      eventListener.stop();

      assert.strictEqual(eventListener["stopped"], true);
      assert.ok(pollStopSpy.calledOnce);
    });
  });

  describe("listenForEvents()", () => {
    let useSlowFrequencySpy: sinon.SinonSpy;
    let useFastFrequencySpy: sinon.SinonSpy;
    let isDockerAvailableStub: sinon.SinonStub;
    let systemEventsRawStub: sinon.SinonStub;
    let readValuesFromStreamStub: sinon.SinonStub;
    let handleEventStub: sinon.SinonStub;
    let getContextValueStub: sinon.SinonStub;
    let setContextValueStub: sinon.SinonStub;

    const eventStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify(TEST_CONTAINER_EVENT)));
        controller.close();
      },
    });

    this.beforeEach(() => {
      useSlowFrequencySpy = sandbox.spy(eventListener["poller"], "useSlowFrequency");
      useFastFrequencySpy = sandbox.spy(eventListener["poller"], "useFastFrequency");
      isDockerAvailableStub = sandbox.stub(configs, "isDockerAvailable");

      systemEventsRawStub = sandbox.stub(SystemApi.prototype, "systemEventsRaw").resolves({
        raw: {
          body: eventStream,
        },
      } as ApiResponse<EventMessage>);

      readValuesFromStreamStub = sandbox.stub(eventListener, "readValuesFromStream");

      handleEventStub = sandbox.stub(eventListener, "handleEvent").resolves();

      // default handling for initial result getContextValue(ContextValues.dockerServiceAvailable)
      getContextValueStub = sandbox.stub(contextValuesModule, "getContextValue").returns(false);
      // for setContextValue(ContextValues.dockerServiceAvailable, boolean  )
      setContextValueStub = sandbox.stub(contextValuesModule, "setContextValue").resolves();
    });

    it("should poll slowly if Docker is not available", async function () {
      this.retries(2); // retry this test up to 2 times if it fails

      const dockerAvailable = false;
      isDockerAvailableStub.resolves(dockerAvailable);

      readValuesFromStreamStub.returns(
        (async function* () {
          yield JSON.stringify(TEST_CONTAINER_EVENT);
        })(),
      );

      // start the poller, which calls into `listenForEvents()` immediately
      eventListener.start();
      // advance the clock to allow the event listener logic to execute
      await clock.tickAsync(100);

      // we should have called these two, then bailed until the next poll
      assert.ok(
        isDockerAvailableStub.calledOnce,
        `isDockerAvailable() called ${isDockerAvailableStub.callCount} times`,
      );
      assert.equal(
        eventListener.dockerAvailable,
        dockerAvailable,
        `dockerAvailable should be ${dockerAvailable}, but is ${eventListener.dockerAvailable}`,
      );
      assert.ok(
        useSlowFrequencySpy.calledOnce,
        `useSlowFrequency() called ${useSlowFrequencySpy.callCount} times`,
      );
      // and we shouldn't have reached any of these
      assert.ok(
        useFastFrequencySpy.notCalled,
        `useFastFrequency() called ${useFastFrequencySpy.callCount} times`,
      );
      assert.ok(
        systemEventsRawStub.notCalled,
        `systemEventsRaw() called ${systemEventsRawStub.callCount} time(s)`,
      );
      assert.ok(
        readValuesFromStreamStub.notCalled,
        `readValuesFromStream() called ${readValuesFromStreamStub.callCount} time(s)`,
      );
      assert.ok(
        handleEventStub.notCalled,
        `handleEvent() called ${handleEventStub.callCount} times`,
      );
    });

    it("should poll more frequently and make a request for system events if Docker is available", async function () {
      this.retries(2); // retry this test up to 2 times if it fails

      const dockerAvailable = true;
      isDockerAvailableStub.resolves(dockerAvailable);

      readValuesFromStreamStub.returns(
        (async function* () {
          yield JSON.stringify(TEST_CONTAINER_EVENT);
        })(),
      );

      // start the poller, which calls into `listenForEvents()` immediately
      eventListener.start();
      // advance the clock to allow the event listener logic to execute
      await clock.tickAsync(100);

      assert.ok(
        isDockerAvailableStub.calledOnce,
        `isDockerAvailable() called ${isDockerAvailableStub.callCount} times`,
      );
      assert.equal(
        eventListener.dockerAvailable,
        dockerAvailable,
        `dockerAvailable should be ${dockerAvailable}, but is ${eventListener.dockerAvailable}`,
      );
      assert.ok(
        useSlowFrequencySpy.notCalled,
        `useSlowFrequency() called ${useSlowFrequencySpy.callCount} times`,
      );
      assert.ok(
        useFastFrequencySpy.calledOnce,
        `useFastFrequency() called ${useFastFrequencySpy.callCount} times`,
      );
      assert.ok(
        systemEventsRawStub.calledOnce,
        `systemEventsRaw() called ${systemEventsRawStub.callCount} times`,
      );
      assert.ok(
        readValuesFromStreamStub.calledOnceWith(eventStream),
        `readValuesFromStream() called ${readValuesFromStreamStub.callCount} times with ${JSON.stringify(readValuesFromStreamStub.args)}`,
      );
      assert.ok(
        handleEventStub.calledOnceWith(TEST_CONTAINER_EVENT),
        `handleEvent() called ${handleEventStub.callCount} times with ${JSON.stringify(handleEventStub.args)}`,
      );
    });

    it("should update the 'localKafkaClusterAvailable' context value if the connection to Docker is lost and an error with cause 'other side closed' is thrown while reading from the event stream", async function () {
      this.retries(2); // retry this test up to 2 times if it fails

      const dockerAvailable = true;
      isDockerAvailableStub.resolves(dockerAvailable);

      // stub the readValuesFromStream method to yield a test event and then throw an error
      readValuesFromStreamStub.returns(
        (async function* () {
          yield JSON.stringify(TEST_CONTAINER_EVENT);
          const disconnectedError = new TypeError("terminated");
          disconnectedError.cause = new Error("other side closed");
          throw disconnectedError;
        })(),
      );

      // stub the localKafkaConnected.fire method.
      const localKafkaConnectedFireStub = sandbox.stub(localKafkaConnected, "fire");

      // start the poller, which calls into `listenForEvents()` immediately
      eventListener.start();
      // advance the clock to allow the event listener logic to execute
      await clock.tickAsync(100);

      assert.ok(
        isDockerAvailableStub.calledOnce,
        `isDockerAvailable() called ${isDockerAvailableStub.callCount} times`,
      );
      assert.equal(
        eventListener.dockerAvailable,
        dockerAvailable,
        `dockerAvailable should be ${dockerAvailable}, but is ${eventListener.dockerAvailable}`,
      );
      assert.ok(
        useSlowFrequencySpy.notCalled,
        `useSlowFrequency() called ${useSlowFrequencySpy.callCount} times`,
      );
      assert.ok(
        useFastFrequencySpy.calledOnce,
        `useFastFrequency() called ${useFastFrequencySpy.callCount} times`,
      );

      assert.ok(
        systemEventsRawStub.calledOnce,
        `systemEventsRaw() called ${systemEventsRawStub.callCount} times`,
      );
      assert.ok(
        readValuesFromStreamStub.calledOnceWith(eventStream),
        `readValuesFromStream() called ${readValuesFromStreamStub.callCount} times with ${JSON.stringify(readValuesFromStreamStub.args)}`,
      );
      assert.ok(
        handleEventStub.calledOnceWith(TEST_CONTAINER_EVENT),
        `handleEvent() called ${handleEventStub.callCount} times`,
      );
      // we'll get the event returned, but then catch the error and inform the UI that the local
      // resources are no longer reachable/available
      assert.ok(
        setContextValueStub.calledWith(
          contextValues.ContextValues.localKafkaClusterAvailable,
          false,
        ),
        `setContextValue() called ${setContextValueStub.callCount} times with ${JSON.stringify(setContextValueStub.args)}`,
      );
      assert.ok(
        localKafkaConnectedFireStub.calledOnceWith(false),
        `localKafkaConnected.fire() called ${localKafkaConnectedFireStub.callCount} times with ${JSON.stringify(localKafkaConnectedFireStub.args)}`,
      );
    });

    // Prove that the dockerServiceAvailable context value is being set properly based on the
    // result of isDockerAvailable() + prior value of the context value.
    for (const initialDockerAvailableContextValue of [true, false]) {
      for (const shouldDockerBeAvailable of [true, false]) {
        it(`should control the ContextValues.dockerServiceAvailable value properly when Docker availability is ${shouldDockerBeAvailable} and the initial context value is ${initialDockerAvailableContextValue}`, async function () {
          this.retries(2); // retry this test up to 2 times if it fails
          getContextValueStub.returns(initialDockerAvailableContextValue);
          isDockerAvailableStub.resolves(shouldDockerBeAvailable);
          readValuesFromStreamStub.returns(
            (async function* () {
              yield JSON.stringify(TEST_CONTAINER_EVENT);
            })(),
          );
          // start the poller, which calls into `listenForEvents()` immediately
          eventListener.start();
          // advance the clock to allow the event listener logic to execute
          await clock.tickAsync(100);

          sinon.assert.calledOnce(isDockerAvailableStub);

          // setContextValue(ontextValues.ContextValues.dockerServiceAvailable) should have only be called when the overall state changes.
          if (initialDockerAvailableContextValue !== shouldDockerBeAvailable) {
            sinon.assert.calledOnceWithExactly(
              setContextValueStub,
              contextValues.ContextValues.dockerServiceAvailable,
              shouldDockerBeAvailable,
            );
          } else {
            sinon.assert.notCalled(setContextValueStub);
          }
        });
      }
    }
  });

  describe("readValuesFromStream()", () => {
    it("should successfully read a value from a ReadableStream before yielding", async function () {
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

    it("should exit early if the stream returns 'done'", async function () {
      const handleEventStub = sandbox.stub(eventListener, "handleEvent").resolves();

      const stream: ReadableStream<Uint8Array> = new ReadableStream({
        start(controller) {
          controller.close();
        },
      });
      await eventListener.readValuesFromStream(stream);

      assert.ok(handleEventStub.notCalled);
    });

    it("should exit early if the event listener is stopped", async function () {
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

    it("should exit early if no value is available", async function () {
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

    it("should properly split and yield multiple values from a ReadableStream", async function () {
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
  });

  describe("handleEvent()", () => {
    it("should handle a container event", async function () {
      const handleContainerEventStub = sandbox
        .stub(eventListener, "handleContainerEvent")
        .resolves();

      const eventWithStatus: SystemEventMessage = {
        ...TEST_CONTAINER_EVENT,
        status: "foo",
      };
      await eventListener.handleEvent(eventWithStatus);

      assert.ok(handleContainerEventStub.calledOnceWith(eventWithStatus));
    });

    it("should exit early if the event is missing 'status'", async function () {
      const handleContainerEventStub = sandbox
        .stub(eventListener, "handleContainerEvent")
        .resolves();

      const missingStatusEvent: SystemEventMessage = {
        ...TEST_CONTAINER_EVENT,
        status: undefined,
      };
      await eventListener.handleEvent(missingStatusEvent);

      assert.ok(handleContainerEventStub.notCalled);
    });

    it("should exit early if the event is not a container event", async function () {
      const handleContainerEventStub = sandbox
        .stub(eventListener, "handleContainerEvent")
        .resolves();

      const imageEvent: SystemEventMessage = {
        ...TEST_CONTAINER_EVENT,
        Type: EventMessageTypeEnum.Image,
      };
      await eventListener.handleEvent(imageEvent);

      assert.ok(handleContainerEventStub.notCalled);
    });
  });

  describe("handleContainerEvent()", () => {
    it("should pass a container 'start' event to handleContainerStartEvent()", async function () {
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

    it("should pass a container 'die' event to handleContainerDieEvent()", async function () {
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

    it("should exit early if 'status' is something other than 'start' or 'die'", async function () {
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

    it("should set the 'localKafkaClusterAvailable' context value and cause the 'localKafkaConnected' event emitter to fire if a container from the 'confluent-local' image starts successfully", async function () {
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

      assert.ok(waitForContainerRunningStub.calledOnce);
      assert.ok(waitForServerStartedLogStub.calledOnce);
      assert.ok(
        setContextValueStub.calledOnceWith(
          contextValues.ContextValues.localKafkaClusterAvailable,
          true,
        ),
      );
      assert.ok(localKafkaConnectedFireStub.calledOnceWith(true));
    });
  });

  describe("handleContainerStartEvent()", () => {
    it("should exit early for containers from non-'confluent-local' images", async function () {
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

      assert.ok(waitForContainerRunningStub.notCalled);
      assert.ok(waitForServerStartedLogStub.notCalled);
      assert.ok(setContextValueStub.notCalled);
      assert.ok(localKafkaConnectedFireStub.notCalled);
    });

    it("should exit early if the event is missing an id or image name", async function () {
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

      assert.ok(waitForContainerRunningStub.notCalled);
      assert.ok(waitForServerStartedLogStub.notCalled);
      assert.ok(setContextValueStub.notCalled);
      assert.ok(localKafkaConnectedFireStub.notCalled);
    });
  });

  describe("handleContainerDieEvent()", () => {
    it("should set the 'localKafkaClusterAvailable' context value and cause the 'localKafkaConnected' event emitter to fire if a container from the 'confluent-local' image dies", async function () {
      const event: SystemEventMessage = {
        ...TEST_CONTAINER_EVENT,
        status: "die",
      };
      const setContextValueStub = sandbox.stub(contextValues, "setContextValue").resolves();
      const localKafkaConnectedFireStub = sandbox.stub(localKafkaConnected, "fire");

      await eventListener.handleContainerDieEvent(event);

      assert.ok(
        setContextValueStub.calledOnceWith(
          contextValues.ContextValues.localKafkaClusterAvailable,
          false,
        ),
      );
      assert.ok(localKafkaConnectedFireStub.calledOnceWith(false));
    });

    it("should exit early for containers from non-'confluent-local' images", async function () {
      const event: SystemEventMessage = {
        ...TEST_CONTAINER_EVENT,
        status: "die",
        Actor: { Attributes: { image: "not-confluent-local" } },
      };
      const setContextValueStub = sandbox.stub(contextValues, "setContextValue").resolves();
      const localKafkaConnectedFireStub = sandbox.stub(localKafkaConnected, "fire");

      await eventListener.handleContainerDieEvent(event);

      assert.ok(setContextValueStub.notCalled);
      assert.ok(localKafkaConnectedFireStub.notCalled);
    });

    it("should exit early if the event is missing an image name", async function () {
      const event: SystemEventMessage = {
        ...TEST_CONTAINER_EVENT,
        status: "die",
        Actor: undefined,
      };
      const setContextValueStub = sandbox.stub(contextValues, "setContextValue").resolves();
      const localKafkaConnectedFireStub = sandbox.stub(localKafkaConnected, "fire");

      await eventListener.handleContainerDieEvent(event);

      assert.ok(setContextValueStub.notCalled);
      assert.ok(localKafkaConnectedFireStub.notCalled);
    });
  });

  describe("matchContainerStatus()", () => {
    it("should return true if the container status is matched", async function () {
      const containerStateStatus: ContainerStateStatusEnum = ContainerStateStatusEnum.Running;

      const containerInspectStub = sandbox
        .stub(ContainerApi.prototype, "containerInspect")
        .resolves({
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

    it("should return false if the container status is not matched", async function () {
      const containerStateStatus: ContainerStateStatusEnum = ContainerStateStatusEnum.Created;

      const containerInspectStub = sandbox
        .stub(ContainerApi.prototype, "containerInspect")
        .resolves({
          State: { Status: containerStateStatus },
        });

      const containerId = TEST_CONTAINER_EVENT.id!;
      const result: boolean = await eventListener.matchContainerStatus(
        containerId,
        ContainerStateStatusEnum.Running,
      );

      assert.strictEqual(result, false);
      assert.ok(containerInspectStub.calledOnceWith({ id: containerId }));
    });
  });

  describe("waitForContainerLog()", () => {
    it("should return true if the container logs contain the expected string", async function () {
      const stringToMatch = "expected string";

      const containerLogsRawStub = sandbox
        .stub(ContainerApi.prototype, "containerLogsRaw")
        .resolves({
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
      const result: boolean = await eventListener.waitForContainerLog(
        id,
        stringToMatch,
        Date.now(),
      );

      assert.strictEqual(result, true);
      assert.ok(containerLogsRawStub.calledOnceWith({ id, since, follow: true, stdout: true }));
    });

    it("should return false if the container logs do not contain the expected string", async function () {
      const stringToMatch = "expected string";

      const containerLogsRawStub = sandbox
        .stub(ContainerApi.prototype, "containerLogsRaw")
        .resolves({
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
});
