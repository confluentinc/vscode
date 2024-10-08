import { isDockerAvailable } from ".";
import {
  ApiResponse,
  ContainerApi,
  ContainerInspectResponse,
  EventMessage,
  SystemApi,
  SystemEventsRequest,
} from "../clients/docker";
import { ContextValues, setContextValue } from "../context";
import { localKafkaConnected } from "../emitters";
import { Logger } from "../logging";
import { defaultRequestInit } from "./configs";

const logger = new Logger("docker.listener");

export const LOCAL_KAFKA_IMAGE = "confluentinc/confluent-local";
const EVENT_FILTERS = {
  type: ["container"],
  images: [LOCAL_KAFKA_IMAGE],
};
// log line to watch for before considering the container fully started and discoverable
const SERVER_STARTED_LOG_LINE = "Server started, listening for requests...";

/**
 * Continuously check for Docker availability and query the system events.
 * Depending on the (Docker) event, we may emit (extension) events to update the UI.
 */
export async function listenForEvents(): Promise<void> {
  const client = new SystemApi();
  const init: RequestInit = defaultRequestInit();
  const queryParams: SystemEventsRequest = {
    filters: JSON.stringify(EVENT_FILTERS),
  };

  // keep a top-level loop running in case we lose connection to docker or the stream ends
  // or something else goes wrong
  while (true) {
    // check if Docker is available before trying to listen for events, taking into account the user
    // may have started the extension before Docker is running
    const dockerAvailable: boolean = await isDockerAvailable();
    if (!dockerAvailable) {
      // wait a bit before trying again
      await new Promise((resolve) => {
        setTimeout(resolve, 15_000);
      });
      continue;
    }

    let stream: ReadableStream<Uint8Array> | null = null;
    try {
      // NOTE: we have to use .systemEventsRaw() because .systemEvents() tries to convert the
      // response to JSON instead of returning a readable stream, which silently fails
      const response: ApiResponse<EventMessage> = await client.systemEventsRaw(queryParams, init);
      stream = response.raw.body as ReadableStream<Uint8Array>;
    } catch (error) {
      logger.error("error getting event stream:", error);
      await new Promise((resolve) => {
        setTimeout(resolve, 1000);
      });
      continue;
    }

    if (!stream) {
      logger.debug("stream from event response is null");
      await new Promise((resolve) => {
        setTimeout(resolve, 1000);
      });
      continue;
    }

    // this will block until the stream ends or an error occurs, so we don't have to keep making
    // requests against /events for each event we want to capture
    await readEventStream(stream);
  }
}

/** Read the event stream and attempt to parse events before additional handling. */
export async function readEventStream(stream: ReadableStream<Uint8Array>): Promise<void> {
  const reader: ReadableStreamDefaultReader<Uint8Array> = stream.getReader();
  logger.debug("listening for events...", { locked: stream.locked });
  while (true) {
    try {
      // read an individual event from the stream
      const { done, value } = await reader.read();
      if (done) {
        logger.debug("events stream ended");
        break;
      }
      if (!value) {
        logger.debug("empty value from events stream");
        continue;
      }
      // convert the Uint8Array to a string and try to parse as JSON
      const eventString = new TextDecoder().decode(value);
      if (!eventString || eventString === "") {
        logger.debug("empty event string from events stream");
        continue;
      }

      let event: CustomEventMessage;
      try {
        event = JSON.parse(eventString);
      } catch (error) {
        logger.error("error parsing event:", error);
        // TODO: notify the user of the error here? if a container we care about is started or
        // stopped, we may miss it if we can't parse the event, and they may need to manually refresh
        // the view to see the current state
        continue;
      }
      await handleEvent(event);
    } catch (error) {
      logger.error("error reading events stream:", error);
      break;
    }
  }
}

/** Custom event message type that includes additional fields we care about. */
export interface CustomEventMessage extends EventMessage {
  status: string;
  id: string;
  from: string;
}

export async function handleEvent(event: CustomEventMessage): Promise<void> {
  logger.trace("event observed:", event);

  if (event.Type !== "container" || !event.status || !event.Actor?.Attributes?.image) {
    logger.debug("container event missing required fields:", event);
    return;
  }

  logger.debug("container event:", { status: event.status, image: event.Actor?.Attributes?.image });
  // NOTE: if we start adding more images to the `images` filter, we'll need to check those here
  if (event.status === "start") {
    await handleContainerStartEvent(event);
  } else if (event.status === "die") {
    await handleContainerDieEvent(event);
  }
}

/** Handling for an event that describes when a container starts for the first time or is started from
 * a stopped state. */
export async function handleContainerStartEvent(event: CustomEventMessage): Promise<void> {
  const imageName: string = event.Actor ? event.Actor.Attributes?.image ?? "" : "";
  if (!imageName) {
    return;
  }

  // capture the time of the event (or use the current time if not available) in case we need to
  // compare it to container log timestamps
  const eventTime: number = event.time ? event.time : new Date().getTime();

  // wait for the container to be in a "Running" state (and optionally show the correct log line
  // if it's the `confluentinc/confluent-local` image) before we consider it fully started
  let started = await waitForContainerRunning(event, eventTime);
  if (!started) {
    logger.debug(`container didn't start in time, bailing and trying again later...`);
    return;
  }

  if (imageName.startsWith(LOCAL_KAFKA_IMAGE) && started) {
    logger.debug(
      `container status shows "running", checking logs for "${SERVER_STARTED_LOG_LINE}"...`,
    );
    started = await waitForServerStartedLog(event.id, eventTime);

    await setContextValue(ContextValues.localKafkaClusterAvailable, started);
    localKafkaConnected.fire(started);
  }
  // TODO: handle other images we care about here
}

/** Handling for an event that describes when a container is stopped. */
export async function handleContainerDieEvent(event: CustomEventMessage) {
  const imageName: string = event.Actor ? event.Actor.Attributes?.image ?? "" : "";
  if (!imageName) {
    return;
  }

  if (imageName.startsWith(LOCAL_KAFKA_IMAGE)) {
    await setContextValue(ContextValues.localKafkaClusterAvailable, false);
    localKafkaConnected.fire(false);
  }
  // TODO: handle other images we care about here
}

/** Wait for the container to be in a "Running" state. */
export async function waitForContainerRunning(
  event: CustomEventMessage,
  since: number,
  maxWaitTimeSec: number = 60,
): Promise<boolean> {
  // TODO: make wait time configurable?
  let started = false;

  const client = new ContainerApi();
  const init: RequestInit = defaultRequestInit();

  while (true) {
    try {
      const container: ContainerInspectResponse = await client.containerInspect(
        { id: event.id },
        init,
      );
      logger.debug(`container state:`, {
        image: event.from,
      });
      if (container.State?.Running) {
        started = true;
        break;
      }
    } catch (error) {
      logger.warn(`container not ready yet, waiting...`, { error });
    }

    if (Date.now() - since > maxWaitTimeSec * 1000) {
      logger.debug("timed out waiting for container to start");
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return started;
}

/**
 * When the `confluent-local` container starts, it should show the following log line once it's ready:
 * "Server started, listening for requests..."
 * So we need to wait for that log line to appear before we consider the container fully ready.
 */
export async function waitForServerStartedLog(
  containerId: string,
  since: number,
  maxWaitTimeSec: number = 60,
): Promise<boolean> {
  // TODO: make wait time configurable?
  let logLineFound = false;

  const client = new ContainerApi();
  const init: RequestInit = defaultRequestInit();

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
  const reader = stream.getReader();

  let logLine = "";
  const startTime = Date.now();
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    const chunk = new TextDecoder().decode(value);
    logLine += chunk;

    if (logLine.includes(SERVER_STARTED_LOG_LINE)) {
      logger.debug("server started log line found");
      logLineFound = true;
      break;
    }

    if (Date.now() - startTime > maxWaitTimeSec * 1000) {
      logger.debug("timed out waiting for server started log line");
      break;
    }
  }
  reader.cancel();
  return logLineFound;
}
