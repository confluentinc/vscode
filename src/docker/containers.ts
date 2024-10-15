import { window, workspace, WorkspaceConfiguration } from "vscode";
import {
  ContainerApi,
  ContainerCreateOperationRequest,
  ContainerCreateRequest,
  ContainerListRequest,
  ContainerSummary,
  ResponseError,
} from "../clients/docker";
import { Logger } from "../logging";
import {
  LOCAL_KAFKA_PLAINTEXT_PORTS,
  LOCAL_KAFKA_REST_HOST,
  LOCAL_KAFKA_REST_PORT,
} from "../preferences/constants";
import { defaultRequestInit } from "./configs";
import { streamToString } from "./stream";

const logger = new Logger("docker.containers");

export async function getContainersForImage(
  imageRepo: string,
  imageTag: string,
): Promise<ContainerSummary[]> {
  const client = new ContainerApi();
  const init: RequestInit = defaultRequestInit();

  // if the tag is "latest", we don't need to specify it
  const repoTag = imageTag === "latest" ? imageRepo : `${imageRepo}:${imageTag}`;
  const request: ContainerListRequest = {
    filters: JSON.stringify({ ancestor: [repoTag] }),
  };

  try {
    const response: ContainerSummary[] = await client.containerList(request, init);
    logger.debug("Containers listed successfully", JSON.stringify(response));
    return response;
  } catch (error) {
    if (error instanceof ResponseError) {
      const body = await streamToString(error.response.clone().body);
      logger.error("Error response listing containers:", {
        status: error.response.status,
        statusText: error.response.statusText,
        body: body,
      });
    } else {
      logger.error("Error listing containers:", error);
    }
  }
  return [];
}

export async function createContainer(imageRepo: string, imageTag: string) {
  const existingContainers: ContainerSummary[] = await getContainersForImage(imageRepo, imageTag);
  if (existingContainers.length > 0 && existingContainers[0].Id) {
    const containerId: string = existingContainers[0].Id;
    window
      .showWarningMessage(
        "Local Kafka container already exists.",
        "Start Container",
        "Delete Container",
      )
      .then((selection) => {
        if (selection === "Start Container") {
          startContainer(imageRepo, imageTag);
        } else if (selection === "Delete Container") {
          deleteContainer(containerId);
        }
      });
    return;
  }
  logger.debug("Creating container from image", { imageRepo, imageTag });

  const repoTag = `${imageRepo}:${imageTag}`;
  const client = new ContainerApi();
  const init: RequestInit = defaultRequestInit();

  const config: WorkspaceConfiguration = workspace.getConfiguration();

  const kafkaRestHost: string = config.get(LOCAL_KAFKA_REST_HOST, "localhost");
  const kafkaRestPort: number = config.get(LOCAL_KAFKA_REST_PORT, 8082);
  const plaintextPorts: number[] = config.get(LOCAL_KAFKA_PLAINTEXT_PORTS, [9092]);

  // TODO: change this depending on image
  const brokerContainerName: string = "confluent-local-broker-1";

  // create the container before starting
  const body: ContainerCreateRequest = {
    Image: repoTag,
    Hostname: brokerContainerName,
    Cmd: ["bash", "-c", "'/etc/confluent/docker/run'"],
    ExposedPorts: {
      [`${kafkaRestPort}/tcp`]: {},
      ...plaintextPorts.reduce((acc, port) => ({ ...acc, [`${port}/tcp`]: {} }), {}),
    },
    HostConfig: {
      NetworkMode: "confluent-local-network",
      PortBindings: {
        [`${kafkaRestPort}/tcp`]: [
          {
            HostIp: config.get(LOCAL_KAFKA_REST_HOST, kafkaRestHost),
            HostPort: kafkaRestPort.toString(),
          },
        ],
        ...plaintextPorts.reduce(
          (acc, port) => ({
            ...acc,
            [`${port}/tcp`]: [{ HostIp: kafkaRestHost, HostPort: port.toString() }],
          }),
          {},
        ),
      },
    },
    Env: [
      // "KAFKA_BROKER_ID=1",
      // "KAFKA_LISTENER_SECURITY_PROTOCOL_MAP=CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT,PLAINTEXT_HOST:PLAINTEXT",
      // `KAFKA_ADVERTISED_LISTENERS=PLAINTEXT://${brokerContainerName}:${plaintextPorts[0]},PLAINTEXT_HOST://localhost:${plaintextPorts[0]}`,
      // "KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR=1",
      // "KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS=0",
      // "KAFKA_TRANSACTION_STATE_LOG_MIN_ISR=1",
      // "KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR=1",
      // "KAFKA_PROCESS_ROLES=broker,controller",
      // "KAFKA_NODE_ID=1",
      // `KAFKA_CONTROLLER_QUORUM_VOTERS=1@${brokerContainerName}:${plaintextPorts[1]}`,
      // `KAFKA_LISTENERS=PLAINTEXT://${brokerContainerName}:${plaintextPorts[0]},CONTROLLER://${brokerContainerName}:${plaintextPorts[1]},PLAINTEXT_HOST://0.0.0.0:${plaintextPorts[0]}`,
      // "KAFKA_INTER_BROKER_LISTENER_NAME=PLAINTEXT",
      // "KAFKA_CONTROLLER_LISTENER_NAMES=CONTROLLER",
      // "KAFKA_LOG_DIRS=/tmp/kraft-combined-logs",
      // "KAFKA_REST_HOST_NAME=rest-proxy",
      // `KAFKA_REST_LISTENERS=http://0.0.0.0:${kafkaRestPort}`,
      // `KAFKA_REST_BOOTSTRAP_SERVERS=${brokerContainerName}:${plaintextPorts[0]}`,
    ],
    Tty: true,
  };
  const request: ContainerCreateOperationRequest = {
    body,
    name: brokerContainerName,
    platform: process.platform,
  };

  try {
    const response = await client.containerCreate(request, init);
    logger.info("Container created successfully", response);
  } catch (error) {
    if (error instanceof ResponseError) {
      const body = await streamToString(error.response.clone().body);
      logger.error("Container creation returned error response:", {
        status: error.response.status,
        statusText: error.response.statusText,
        body: body,
      });
    } else {
      logger.error("Error creating container:", error);
    }
  }
}

export async function startContainer(imageRepo: string, imageTag: string) {
  // TODO: implement startContainer
}

export async function deleteContainer(id: string) {
  const client = new ContainerApi();
  const init: RequestInit = defaultRequestInit();

  try {
    await client.containerDelete({ id }, init);
  } catch (error) {
    if (error instanceof ResponseError) {
      const body = await streamToString(error.response.clone().body);
      logger.error("Error response deleting container:", {
        status: error.response.status,
        statusText: error.response.statusText,
        body: body,
      });
    } else {
      logger.error("Error removing container:", error);
    }
  }
}
