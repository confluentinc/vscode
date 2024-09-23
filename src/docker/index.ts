import Dockerode from "dockerode";
import { commands } from "vscode";
import { Logger } from "../logging";

const logger = new Logger("docker");

let dockerClient: Dockerode;
export function getDockerClient() {
  if (!dockerClient) {
    // TODO: support docker connection configurations from extension settings
    dockerClient = new Dockerode();
  }
  return dockerClient;
}

export function listenForDockerEvents() {
  const docker = getDockerClient();

  const imageFilters = { image: ["confluent-local"] };

  docker.getEvents({ filters: imageFilters }, (err: any, data) => {
    if (!isDockerAvailable()) {
      return;
    }
    if (err) {
      logger.error(err);
      return;
    }
    if (!data) {
      return;
    }
    data.on("data", processEvent);
  });
}

export function isDockerAvailable(): boolean {
  try {
    const dockerVersion = getDockerClient().version();
    logger.debug("docker version", dockerVersion);
    return true;
  } catch (error) {
    logger.error("can't get docker version; assuming docker is unreachable/unavailable", error);
    return false;
  }
}

async function processEvent(event: any) {
  try {
    event = JSON.parse(event.toString());
  } catch (error) {
    logger.error("error parsing event", error);
    return;
  }

  if (!event.Type) {
    logger.warn("event missing type", event);
    return;
  }

  if (event.Type === "container") {
    await processContainerEvent(event);
  }
}

async function processContainerEvent(event: any) {
  if (!event.status) {
    logger.warn("container event missing status", event);
    return;
  }

  logger.debug("event", event);
  // NOTE: if we start adding more images to the getEvents filter, we'll need to check those here
  if (event.status === "start") {
    await commands.executeCommand("setContext", "confluent.localKafkaClusterAvailable", true);
  } else if (event.status === "die") {
    await commands.executeCommand("setContext", "confluent.localKafkaClusterAvailable", false);
  }
}
