import { ContextValues, setContextValue } from "../context";
import { localKafkaConnected } from "../emitters";
import { Logger } from "../logging";
import { DockerClient } from "./client";

const logger = new Logger("docker.listener");

const EVENT_QUERY_PARAMS = {
  type: ["container"],
  event: ["start", "die"],
  images: ["confluentinc/confluent-local"],
};

export async function getEvents(): Promise<void> {
  const client = DockerClient.getInstance();

  const queryParams = JSON.stringify(EVENT_QUERY_PARAMS);
  const endpoint = "/events?filters=" + encodeURIComponent(queryParams);

  // keep a top-level loop running in case we lose connection to docker or the stream ends
  // or something else goes wrong
  while (true) {
    // make sure docker is available first
    try {
      await client.request("/_ping");
    } catch (error) {
      if (error instanceof Error) {
        logger.warn("can't ping docker; not listening for events: ", error.message);
      }
      await new Promise((resolve) => {
        setTimeout(resolve, 15_000);
      });
      continue;
    }

    const response = await client.request(endpoint);
    if (!response.ok) {
      logger.warn("error response trying to get events: ", {
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
        logger.error("error reading stream", error);
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

  if (event?.Type === "container") {
    await handleContainerEvent(event);
  }
}

async function handleContainerEvent(event: any) {
  if (!event.status) {
    logger.warn("container event missing status", event);
    return;
  }

  // NOTE: if we start adding more images to the `images` filter, we'll need to check those here
  if (event.status === "start") {
    await waitForContainerRunning(event);

    // wait a bit longer for the container to be fully ready and discoverable by the sidecar
    // TODO: try getting container logs to see when it's ready
    await new Promise((resolve) => setTimeout(resolve, 5000));

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
  const containerName = event.Actor.Attributes.name;
  const client = DockerClient.getInstance();

  while (true) {
    try {
      const response = await client.request(`/containers/${containerId}/json`);
      const containerInfo = await response.json();
      logger.debug(`container "${containerName}" state: `, {
        state: containerInfo?.State,
        image: event.from,
      });
      if (containerInfo?.State.Running) {
        break;
      }
    } catch (error) {
      logger.warn(`container "${containerName}" not ready yet, waiting...`, error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
