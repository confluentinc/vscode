import { ContextValues, setContextValue } from "../context";
import { localKafkaConnected } from "../emitters";
import { Logger } from "../logging";
import { DockerClient } from "./client";

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
 * Depending on the event, we may emit events to update the UI.
 * @see https://docs.docker.com/reference/api/engine/version/v1.47/#tag/System/operation/SystemEvents
 */
export async function listenForEvents(): Promise<void> {
  const client = DockerClient.getInstance();

  // TODO: make user-configurable with WorkspaceConfiguration?
  const queryParams = JSON.stringify(EVENT_FILTERS);
  const endpoint = "/events?filters=" + encodeURIComponent(queryParams);

  // keep a top-level loop running in case we lose connection to docker or the stream ends
  // or something else goes wrong
  while (true) {
    // check if Docker is available before trying to listen for events, taking into account the user
    // may have started the extension before Docker is running
    const isDockerAvailable = await pingDocker();
    if (!isDockerAvailable) {
      // wait a bit before trying again
      await new Promise((resolve) => {
        setTimeout(resolve, 15_000);
      });
      continue;
    }

    try {
      const response = await client.request(endpoint);
      if (!response.ok) {
        logger.debug("error response trying to get events:", {
          status: response.status,
          statusText: response.statusText,
        });
        await new Promise((resolve) => {
          setTimeout(resolve, 5000);
        });
        continue;
      }
      // this will block until the stream ends or an error occurs, so we don't have to keep making
      // requests against /events for each event we want to capture
      await readEventStream(response.body as ReadableStream<Uint8Array>);
    } catch (error) {
      logger.error("error getting event stream:", error);
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 1000);
    });
  }
}

/**
 * Check if Docker is available by attempting to ping the API.
 * @see https://docs.docker.com/reference/api/engine/version/v1.47/#tag/System/operation/SystemPing
 */
export async function pingDocker(): Promise<boolean> {
  try {
    const resp = await DockerClient.getInstance().request("/_ping");
    logger.debug("docker ping response:", resp);
    return true;
  } catch (error) {
    if (error instanceof Error) {
      logger.debug("can't ping docker; not listening for events:", { error: error.message });
    }
  }
  return false;
}

/** Read the event stream and attempt to parse events before handling. */
export async function readEventStream(stream: ReadableStream<Uint8Array>) {
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
      if (!eventString) {
        logger.debug("empty event string from events stream");
        continue;
      }

      try {
        const event: SystemEvent = JSON.parse(eventString);
        await handleEvent(event);
      } catch (error) {
        logger.error("error parsing event", { error, eventString });
        // TODO: notify the user of the error here? if a container we care about is started or
        // stopped, we may miss it if we can't parse the event, and they may need to manually refresh
        // the view to see the current state
        continue;
      }
    } catch (error) {
      logger.error("error reading events stream:", error);
      break;
    }
  }
}

export interface SystemEvent {
  status: string;
  id: string;
  from: string;
  Type: string;
  Action: string;
  Actor: {
    ID: string;
    Attributes: {
      [key: string]: string;
    };
  };
  scope: string;
  time: number;
  timeNano: number;
}

export async function handleEvent(event: SystemEvent) {
  logger.debug("docker event observed: ", event);

  if (event.Type !== "container" || !event.status || !event.from) {
    logger.debug("container event missing required fields:", event);
    return;
  }

  logger.debug("container event:", { status: event.status, image: event.from });
  // NOTE: if we start adding more images to the `images` filter, we'll need to check those here
  if (event.status === "start") {
    await handleContainerStartEvent(event);
  } else if (event.status === "die") {
    await handleContainerDieEvent(event);
  }
}

/** Handling for an event that describes when a container starts for the first time or is started from
 * a stopped state. */
export async function handleContainerStartEvent(event: SystemEvent) {
  const imageName: string = event.Actor ? event.Actor.Attributes?.image ?? "" : "";
  if (!imageName) {
    return;
  }

  // capture the time of the event (or use the current time if not available) in case we need to
  // compare it to container log timestamps
  const eventTime: number = event.time ? event.time : new Date().getTime();

  // wait for the container to be in a "Running" state (and optionally show the correct log line
  // if it's the `confluentinc/confluent-local` image) before we consider it fully started
  let started = await waitForContainerRunning(event);
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
export async function handleContainerDieEvent(event: SystemEvent) {
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
  event: any,
  maxWaitTimeSec: number = 60,
): Promise<boolean> {
  // TODO: make wait time configurable?
  let started = false;

  while (true) {
    try {
      const response = await DockerClient.getInstance().request(`/containers/${event.id}/json`);
      const containerInfo = await response.json();
      logger.debug(`container state:`, {
        state: containerInfo?.State,
        image: event.from,
      });
      if (containerInfo?.State.Running) {
        started = true;
        break;
      }
    } catch (error) {
      logger.warn(`container not ready yet, waiting...`, { error });
    }

    if (Date.now() - event.time > maxWaitTimeSec * 1000) {
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

  const endpoint = `/containers/${containerId}/logs?follow=true&stdout=true&since=${since}`;

  let logStream;
  try {
    const response = await DockerClient.getInstance().request(endpoint);
    if (!response.ok) {
      const body = await response.text();
      logger.error("error response trying to get log stream:", {
        body,
        status: response.status,
        statusText: response.statusText,
      });
      return logLineFound;
    }
    logStream = response.body;
  } catch (error) {
    logger.error("error getting log stream:", error);
    return logLineFound;
  }
  const reader = logStream.getReader();

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
