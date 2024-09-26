import { ContextValues, setContextValue } from "../context";
import { localKafkaConnected } from "../emitters";
import { Logger } from "../logging";
import { DockerClient } from "./client";

const logger = new Logger("docker.listener");

export async function getEvents(): Promise<void> {
  const client = DockerClient.getInstance();

  const eventQueryParams = {
    type: ["container"],
    // event: ["start", "die"],
    images: ["confluentinc/confluent-local"],
  };
  const queryParams = JSON.stringify(eventQueryParams);
  const endpoint = "/events?filters=" + encodeURIComponent(queryParams);

  // keep a top-level loop running in case we lose connection to docker or the stream ends
  // or something else goes wrong
  while (true) {
    // make sure docker is available first
    try {
      await client.request("/_ping");
    } catch (error) {
      if (error instanceof Error) {
        logger.warn("can't ping docker; not listening for events:", error.message);
      }
      await new Promise((resolve) => {
        setTimeout(resolve, 15_000);
      });
      continue;
    }

    const response = await client.request(endpoint);
    if (!response.ok) {
      logger.warn("error response trying to get events:", {
        status: response.status,
        statusText: response.statusText,
      });
      await new Promise((resolve) => {
        setTimeout(resolve, 5000);
      });
      continue;
    }

    // this section will block until the stream ends or an error occurs, so we don't have to keep
    // making requests against /events for each event we want to capture
    const body: ReadableStream = response.body;
    const reader: ReadableStreamDefaultReader<any> = body.getReader();
    logger.debug("listening for events...", { locked: body.locked });
    while (true) {
      try {
        const { done, value } = await reader.read();
        if (done) break;
        const event = new TextDecoder().decode(value);
        await handleEvent(event);
      } catch (error) {
        logger.error("error reading events stream:", error);
        break;
      }
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 1000);
    });
  }
}

export async function handleEvent(event: any) {
  try {
    event = JSON.parse(event.toString());
  } catch (error) {
    logger.error("error parsing event", error);
    return;
  }
  logger.debug("docker event observed: ", event);

  if (event?.Type === "container") {
    await handleContainerEvent(event);
  }
}

async function handleContainerEvent(event: any) {
  if (!event.status) {
    logger.warn("container event missing status:", event);
    return;
  }

  const eventTime: number = event.time ? event.time : new Date().getTime();
  const imageName: string = event?.Actor ? event.Actor.Attributes?.image ?? "" : "";
  logger.debug("container event:", { status: event.status, image: imageName });

  // NOTE: if we start adding more images to the `images` filter, we'll need to check those here
  if (event.status === "start") {
    await waitForContainerRunning(event);
    if (imageName.startsWith("confluentinc/confluent-local")) {
      logger.debug("container is running, checking logs...");
      await waitForServerStartedLog(event.id, eventTime);
    }
    await setContextValue(ContextValues.localKafkaClusterAvailable, true);
    localKafkaConnected.fire(true);
  } else if (event.status === "die") {
    await setContextValue(ContextValues.localKafkaClusterAvailable, false);
    localKafkaConnected.fire(false);
  }
}

/** Wait for the container to be in a "Running" state. */
async function waitForContainerRunning(event: any) {
  const containerId = event.id;
  const client = DockerClient.getInstance();

  while (true) {
    try {
      const response = await client.request(`/containers/${containerId}/json`);
      const containerInfo = await response.json();
      logger.debug(`container state:`, {
        state: containerInfo?.State,
        image: event.from,
      });
      if (containerInfo?.State.Running) {
        break;
      }
    } catch (error) {
      logger.warn(`container not ready yet, waiting...`, { error });
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

/**
 * When the `confluent-local` container starts, it should show the following log line once it's ready:
 * "Server started, listening for requests..."
 * So we need to wait for that log line to appear before we consider the container fully ready.
 */
async function waitForServerStartedLog(
  containerId: string,
  since: number,
  maxWaitTimeSec: number = 60,
) {
  const client = DockerClient.getInstance();

  const endpoint = `/containers/${containerId}/logs?follow=true&stdout=true&since=${since}`;

  let logStream;
  try {
    const response = await client.request(endpoint);
    if (!response.ok) {
      const body = await response.text();
      logger.error("error response trying to get log stream:", {
        body,
        status: response.status,
        statusText: response.statusText,
      });
      return;
    }
    logStream = response.body;
  } catch (error) {
    logger.error("error getting log stream:", error);
    return;
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

    if (logLine.includes("Server started, listening for requests...")) {
      logger.debug("server started log line found");
      break;
    }

    if (Date.now() - startTime > maxWaitTimeSec * 1000) {
      logger.debug("timed out waiting for server started log line");
      break;
    }
  }
  reader.cancel();
}
