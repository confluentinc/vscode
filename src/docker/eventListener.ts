import { window } from "vscode";
import {
  ApiResponse,
  ContainerApi,
  ContainerInspectResponse,
  ContainerStateStatusEnum,
  EventMessage,
  SystemApi,
  SystemEventsRequest,
} from "../clients/docker";
import { ContextValues, setContextValue } from "../context/values";
import { localKafkaConnected, localSchemaRegistryConnected } from "../emitters";
import { Logger } from "../logging";
import { updateLocalConnection } from "../sidecar/connections/local";
import { IntervalPoller } from "../utils/timing";
import {
  defaultRequestInit,
  getLocalKafkaImageName,
  getLocalSchemaRegistryImageName,
  isDockerAvailable,
} from "./configs";
import { DEFAULT_KAFKA_IMAGE_REPO } from "./constants";

const logger = new Logger("docker.eventListener");

const EVENT_FILTERS = {
  type: ["container", "image"],
  images: [DEFAULT_KAFKA_IMAGE_REPO],
};
/** The log line to watch for before considering the container fully started and discoverable. */
export const SERVER_STARTED_LOG_LINE = "Server started, listening for requests...";

/**
 * Singleton class that listens for Docker events and processes them as needed.
 *
 * NOTE: original functionality here was done with module-level functions that worked fine in click-
 * testing, but attempting to create tests for them was difficult due to the way the functions were
 * structured. This class is an attempt to encapsulate the event listener and poller functionality
 * into a single class that can be more easily tested.
 */
export class EventListener {
  /** Did something else in the codebase request that we stop listening for events? This will cause
   * {@link readValuesFromStream()} to exit early if set to `true`. */
  private stopped: boolean = false;
  private handlingEventStream: boolean = false;
  dockerAvailable: boolean = false;

  // singleton pattern to ensure only one instance of the event listener + poller is running
  private static instance: EventListener | null = null;
  private poller: IntervalPoller;
  private constructor() {
    // without the arrow function, `listenForEvents` gets bound to the `IntervalPoller` instance,
    // not the `EventListener` instance, which then causes `this.poller` references to return
    // `undefined` and `this` to return the poller. alternatively, we could use the following:
    // ```ts
    // this.listenForEvents = this.listenForEvents.bind(this);
    // ```
    // while passing `this.listenForEvents()` directly into the `IntervalPoller` constructor
    this.poller = new IntervalPoller(
      "pollDockerEvents",
      () => {
        this.listenForEvents();
      },
      15_000,
      1_000,
      true, // run immediately on start()
    );
  }
  static getInstance(): EventListener {
    if (!EventListener.instance) {
      EventListener.instance = new EventListener();
    }
    return EventListener.instance;
  }

  /** Start the poller and resume listening for events. */
  start(): void {
    this.stopped = false;
    this.poller.start();
  }

  /**
   * Stop the poller and pause listening for events. If any event is being processed, it will
   * attempt to finish and then exit from reading the event stream.
   */
  stop(): void {
    this.poller.stop();
    this.stopped = true;
  }

  /**
   * Main workflow method for the {@link EventListener} class, handling the following:
   * - checking if Docker is available and adjusting the poller frequency accordingly
   * - starting the event stream and reading events from it
   * - handling container start and die events for the `confluentinc/confluent-local` image, to
   *   include checking for a specific log line to appear in the container logs and informing the UI
   *   that a local Kafka cluster is available
   *
   * This should not be called directly from other portions of the codebase, but should solely be
   * controlled by the polling mechanism that starts on extension activation.
   */
  async listenForEvents(): Promise<void> {
    if (this.handlingEventStream) {
      // the poller won't wait for a previous listenForEvents() call to finish, so we need to check
      // if we're still processing events and exit early if we are
      return;
    }

    // check if Docker is available before trying to listen for events, taking into account the user
    // may have started the extension before Docker is running
    this.dockerAvailable = await isDockerAvailable();
    logger.debug("dockerAvailable:", this.dockerAvailable);
    if (!this.dockerAvailable) {
      // use the slower polling frequency (15sec) if Docker isn't available
      this.poller.useSlowFrequency();
      return;
    }

    // Docker is available, so we can use the more frequent (at most every 1sec) polling for events
    // (NOTE: if we get a successful response back from /events, that will block until the stream
    // ends, so we don't have to worry about making requests every second)
    this.poller.useFastFrequency();

    // "lock" the event stream handling so we don't start another one while we're still processing
    this.handlingEventStream = true;
    try {
      // worth noting that this can block for up to about 5 minutes while waiting for events before
      // the stream times out and we (almost immediately) make another request to read system events
      // (if Docker is still available), so we're mainly using the high-frequency polling as a means
      // to quickly latch back onto the event stream if we lose it
      await this.handleEventStreamWorkflow();
    } catch (error) {
      logger.error("error handling event stream:", error);
    }
    this.handlingEventStream = false;
  }

  private async handleEventStreamWorkflow(): Promise<void> {
    const client = new SystemApi();
    const queryParams: SystemEventsRequest = {
      filters: JSON.stringify(EVENT_FILTERS),
    };
    const init: RequestInit = await defaultRequestInit();

    let stream: ReadableStream<Uint8Array> | null = null;
    try {
      // NOTE: we have to use .systemEventsRaw() because .systemEvents() tries to convert the
      // response to JSON instead of returning a readable stream, which silently fails
      const response: ApiResponse<EventMessage> = await client.systemEventsRaw(queryParams, init);
      stream = response.raw.body as ReadableStream<Uint8Array>;
    } catch (error) {
      logger.error("error getting event stream:", error);
      return;
    }

    if (!stream) {
      logger.error("stream from event response is null");
      return;
    }

    try {
      // these will block until the stream ends or an error occurs, so we don't have to keep making
      // .systemEventsRaw() requests for each event we want to capture
      const yieldedEventStrings = this.readValuesFromStream(stream);
      for await (const eventString of yieldedEventStrings) {
        let event: SystemEventMessage;
        try {
          event = JSON.parse(eventString.trim());
        } catch (error) {
          if (error instanceof Error) {
            logger.error("error parsing event", {
              error: error.message,
              eventString: eventString.trim(),
            });
            // TODO: notify the user of the error here? if a container we care about is started or
            // stopped, we may miss it if we can't parse the event, and they may need to manually refresh
            // the view to see the current state
          }
          continue;
        }
        await this.handleEvent(event);
      }
    } catch (error) {
      if (error instanceof TypeError && error.message === "terminated") {
        // usually a stream read timeout (~5min), but could also be a Docker shutdown
        logger.debug("stream ended:", error.cause);
        if (error.cause && (error.cause as Error).message === "other side closed") {
          // Docker shut down and we can't listen for events anymore
          logger.error("lost connection to Docker socket");
          // also inform the UI that the local resources are no longer available
          await setContextValue(ContextValues.localKafkaClusterAvailable, false);
          localKafkaConnected.fire(false);
          // don't stop the poller; let it go through another time and revert to the slower polling
        }
      } else {
        logger.error("error handling events from stream:", error);
      }
    }
  }

  /** Read and decode any returned value(s) from a stream before yielding them for processing until
   * the stream closes or the listener/poller are told to stop. */
  async *readValuesFromStream(
    stream: ReadableStream<Uint8Array>,
    maxWaitTimeSec?: number,
  ): AsyncGenerator<string> {
    logger.debug("reading from stream...");
    const reader: ReadableStreamDefaultReader<Uint8Array> = stream.getReader();
    const decoder = new TextDecoder();

    const startTime = Date.now();
    while (true) {
      // try to read an individual value (as a Uint8Array) from the stream
      const { done, value } = await reader.read();
      if (done) {
        logger.debug("stream ended");
        break;
      }
      if (this.stopped) {
        logger.warn("listener stopped, exiting early");
        break;
      }
      if (!value) {
        logger.debug("got empty value from stream");
        continue;
      }
      // convert the Uint8Array to a string before yielding it
      const valueString = decoder.decode(value);
      if (!valueString) {
        logger.debug("empty string decoded from stream");
        continue;
      }

      if (maxWaitTimeSec && Date.now() - startTime > maxWaitTimeSec * 1000) {
        logger.error("timed out reading from stream");
        break;
      }

      // we may get multiple events in a single string, so split them up and handle each one
      const valueStrings = valueString.trim().split("\n");
      for (const smallerValueString of valueStrings) {
        if (!smallerValueString) {
          // skip empty strings
          continue;
        }
        yield smallerValueString;
      }
    }
  }

  /** Handle a single event, checking for required fields and passing it off to the appropriate
   * handler based on the event type. */
  async handleEvent(event: SystemEventMessage): Promise<void> {
    if (!event.status) {
      logger.debug("missing required 'status' field in event, bailing...", event);
      return;
    }
    logger.trace("handling event:", event);

    if (event.Type === "container") {
      await this.handleContainerEvent(event);
    }
    // TODO: handle other event types we care about here for future functionality
  }

  /** Pass container "start" and "die" events through for further handling. */
  async handleContainerEvent(event: SystemEventMessage): Promise<void> {
    // NOTE: if we start adding more images to the `images` filter, we'll need to check those here
    if (event.status === "start") {
      await this.handleContainerStartEvent(event);
    } else if (event.status === "die") {
      await this.handleContainerDieEvent(event);
    }
  }

  /** Handling for an event that describes when a container starts for the first time or is started from
   * a stopped state. */
  async handleContainerStartEvent(event: SystemEventMessage): Promise<void> {
    if (!event.id || !event.Actor?.Attributes?.image) {
      logger.debug("missing required fields in container start event, bailing...", event);
      return;
    }

    const containerId: string = event.id;
    const imageName: string = event.Actor.Attributes.image;
    // capture the time of the event (or use the current time if not available) in case we need to
    // compare it to container log timestamps
    const eventTime: number = event.time ? event.time : new Date().getTime();

    // first, make sure it's an image we support tracking for updates in the Resources view
    const kafkaImage = getLocalKafkaImageName();
    const schemaRegistryImage = getLocalSchemaRegistryImageName();
    const isManagedImage =
      imageName.startsWith(kafkaImage) || imageName.startsWith(schemaRegistryImage);
    if (!isManagedImage) {
      logger.debug(`ignoring container start event for image: "${imageName}"`);
      return;
    }

    // if it's an image we care about, check if the container is in a "running" state
    let started: boolean = await this.waitForContainerState(
      containerId,
      ContainerStateStatusEnum.Running,
      eventTime,
    );
    if (!started) {
      logger.debug(`container didn't show a 'running' state, bailing and trying again later`);
      return;
    }

    // then if it's an image that requires a specific log line to appear before it's fully ready, wait
    // for that log line to appear before considering the container fully started
    const needToWaitForLog =
      imageName.startsWith(DEFAULT_KAFKA_IMAGE_REPO) || imageName.startsWith(schemaRegistryImage);
    if (needToWaitForLog) {
      // when the `confluent-local` container starts, it should show the following log line once it's ready:
      // "Server started, listening for requests..."
      logger.debug("container status shows 'running', checking container logs...", {
        stringToInclude: SERVER_STARTED_LOG_LINE,
        imageName,
      });
      // show loader in the Resources view while we wait for the correct log line to appear
      // TODO: also update status bar item once it's available
      await window.withProgress(
        {
          location: { viewId: "confluent-resources" },
          title: "Waiting for local resources to be ready...",
        },
        async () => {
          started = await this.waitForContainerLog(containerId, SERVER_STARTED_LOG_LINE, eventTime);
        },
      );
      logger.debug("done waiting for container log line", {
        started,
        stringToInclude: SERVER_STARTED_LOG_LINE,
        imageName,
      });
    }

    if (imageName.startsWith(kafkaImage)) {
      await setContextValue(ContextValues.localKafkaClusterAvailable, started);
      localKafkaConnected.fire(started);
    } else if (imageName.startsWith(schemaRegistryImage)) {
      await setContextValue(ContextValues.localSchemaRegistryAvailable, started);
      localSchemaRegistryConnected.fire(started);
    }
    // delete+recreate the local connection to purge any previous clusters from the sidecar cache
    await updateLocalConnection();
  }

  /** Handling for an event that describes when a container is stopped. */
  async handleContainerDieEvent(event: SystemEventMessage) {
    const imageName: string = event.Actor?.Attributes?.image ?? "";
    if (!imageName) {
      return;
    }
    logger.debug(`container 'die' event for image: ${imageName}`);

    const kafkaImage = getLocalKafkaImageName();
    const schemaRegistryImage = getLocalSchemaRegistryImageName();

    if (imageName.startsWith(kafkaImage)) {
      await setContextValue(ContextValues.localKafkaClusterAvailable, false);
      localKafkaConnected.fire(false);
    } else if (imageName.startsWith(schemaRegistryImage)) {
      await setContextValue(ContextValues.localSchemaRegistryAvailable, false);
      localSchemaRegistryConnected.fire(false);
    }
  }

  /** Wait for the container to show a specific {@link ContainerStateStatusEnum} status. */
  async waitForContainerState(
    containerId: string,
    status: ContainerStateStatusEnum,
    since: number,
    maxWaitTimeSec: number = 60,
  ): Promise<boolean> {
    // TODO: make wait time configurable?
    let started = false;

    while (true) {
      const statusMatched: boolean = await this.matchContainerStatus(containerId, status);
      if (statusMatched) {
        started = true;
        break;
      }
      if (Date.now() - since > maxWaitTimeSec * 1000) {
        logger.debug("timed out waiting for container to start");
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    return started;
  }

  /** Check the status of a container and return `true` if it matches the expected status. */
  async matchContainerStatus(
    containerId: string,
    state: ContainerStateStatusEnum,
  ): Promise<boolean> {
    const client = new ContainerApi();
    const init: RequestInit = await defaultRequestInit();
    try {
      const container: ContainerInspectResponse = await client.containerInspect(
        { id: containerId },
        init,
      );
      logger.debug(`container state:`, {
        state: container.State?.Status,
      });
      if (container.State?.Status === state) {
        return true;
      }
    } catch (error) {
      logger.debug(`error checking container state, waiting and trying again...`, { error });
    }
    return false;
  }

  /** Make a request to `/containers/{id}/logs` and return a readable stream, then match the incoming
   * log strings against a specific log line. */
  async waitForContainerLog(
    containerId: string,
    stringToInclude: string,
    since: number,
    maxWaitTimeSec: number = 60,
  ): Promise<boolean> {
    // TODO: make wait time configurable?
    let logLineFound = false;

    const client = new ContainerApi();
    const init: RequestInit = await defaultRequestInit();

    let stream: ReadableStream<Uint8Array> | null = null;
    try {
      // NOTE: we have to use .containerLogsRaw() because .containerLogs() tries to convert the
      // response to a Blob instead of returning a readable stream, which silently fails
      const response: ApiResponse<Blob> = await client.containerLogsRaw(
        {
          id: containerId,
          since: since,
          follow: true,
          stdout: true,
        },
        init,
      );
      stream = response.raw.body as ReadableStream<Uint8Array>;
    } catch (error) {
      logger.error("error getting log stream:", error);
      return logLineFound;
    }
    if (!stream) {
      return logLineFound;
    }

    let logLine = "";
    for await (const logValue of this.readValuesFromStream(stream, maxWaitTimeSec)) {
      logLine += logValue;
      if (logLine.includes(stringToInclude)) {
        logger.debug("container log line found", { stringToInclude });
        logLineFound = true;
        break;
      }
    }

    return logLineFound;
  }
}

/** Custom event message type that includes additional fields we care about for events (`status` and
 * `id`), not specified in the Docker OpenAPI spec. */
export interface SystemEventMessage extends EventMessage {
  status?: string;
  id?: string;
  // we could also use `from` for the image+tag, but that's already in Actor.Attributes.image
}
