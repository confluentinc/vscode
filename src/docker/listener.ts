import { ContextValues, setContextValue } from "../context";
import { localKafkaConnected } from "../emitters";
import { Logger } from "../logging";
import { DockerClient } from "./client";

const logger = new Logger("docker.listener");

const EVENT_QUERY_PARAMS = {
  type: ["container"],
  event: ["start", "die"],
};

export async function getEvents(): Promise<void> {
  const client = DockerClient.getInstance();

  const queryParams = JSON.stringify(EVENT_QUERY_PARAMS);
  const endpoint = "/events?filters=" + encodeURIComponent(queryParams);

  while (true) {
    // make sure docker is available first
    try {
      await client.get("/_ping");
    } catch (error) {
      if (error instanceof Error) {
        logger.warn("can't ping docker; not listening for events: ", error.message);
      }
      await new Promise((resolve) => {
        setTimeout(resolve, 5000);
      });
      continue;
    }

    // listen for docker events

    const response = await client.get(endpoint);
    if (!response.ok) {
      logger.warn("stream failed", response);
      await new Promise((resolve) => {
        setTimeout(resolve, 5000);
      });
      continue;
    }

    const body: ReadableStream = response.body;
    const reader: ReadableStreamDefaultReader<any> = body.getReader();
    logger.debug("reading event stream...");
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

  if (!event.Type) {
    return;
  }

  if (event.Type === "container") {
    await handleContainerEvent(event);
  }
}

async function handleContainerEvent(event: any) {
  logger.debug("container event", event);
  if (!event.status) {
    logger.warn("container event missing status", event);
    return;
  }

  // NOTE: if we start adding more images to the `images` filter, we'll need to check those here
  if (event.status === "start") {
    await waitForContainerReady(event);
  } else if (event.status === "die") {
    await setContextValue(ContextValues.localKafkaClusterAvailable, false);
    localKafkaConnected.fire(false);
  }
}

async function waitForContainerReady(event: any) {
  const containerId = event.id;
  const containerName = event.Actor.Attributes.name;

  while (true) {
    try {
      const response = await DockerClient.getInstance().get(`/containers/${containerId}/json`);
      const containerInfo = await response.json();
      logger.debug(`container "${containerName}" state`, {
        state: containerInfo?.State,
        id: containerId,
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

  // wait a bit longer for the container to be fully ready and discoverable by the sidecar
  await new Promise((resolve) => setTimeout(resolve, 5000));

  await setContextValue(ContextValues.localKafkaClusterAvailable, true);
  localKafkaConnected.fire(true);
}
