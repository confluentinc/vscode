import * as net from "net";
import { window, workspace, WorkspaceConfiguration } from "vscode";
import {
  ContainerApi,
  ContainerCreateOperationRequest,
  ContainerCreateRequest,
  ContainerCreateResponse,
  ContainerListRequest,
  ContainerStateStatusEnum,
  ContainerSummary,
  ResponseError,
} from "../clients/docker";
import { Logger } from "../logging";
import {
  LOCAL_KAFKA_PLAINTEXT_PORT,
  LOCAL_KAFKA_REST_HOST,
  LOCAL_KAFKA_REST_PORT,
} from "../preferences/constants";
import { defaultRequestInit } from "./configs";
import { imageExists, pullImage } from "./images";
import { streamToString } from "./stream";

const logger = new Logger("docker.containers");

export async function getContainersForImage(
  imageRepo: string,
  imageTag: string,
  status?: ContainerStateStatusEnum,
): Promise<ContainerSummary[]> {
  // if the tag is "latest", we don't need to specify it
  const repoTag = imageTag === "latest" ? imageRepo : `${imageRepo}:${imageTag}`;

  // if `status` is provided, use that instead of listing all containers
  const filters: Record<string, any> = {
    ancestor: [repoTag],
  };
  if (status) filters["status"] = [status];
  const request: ContainerListRequest = {
    filters: JSON.stringify(filters),
  };
  if (!status) request.all = true;

  const client = new ContainerApi();
  const init: RequestInit = defaultRequestInit();
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

export async function createContainer(
  imageRepo: string,
  imageTag: string,
): Promise<ContainerCreateResponse | undefined> {
  const existingContainers: ContainerSummary[] = await getContainersForImage(imageRepo, imageTag);
  if (existingContainers.length > 0) {
    // TODO(shoup): add buttons for (re)start / delete container in follow-on branch
    window.showWarningMessage(
      "Local Kafka container already exists. Please remove it and try again.",
    );
    // isn't shown to the user:
    throw new ContainerExistsError("Container already exists");
  } else {
    if (!(await imageExists(imageRepo, imageTag))) {
      await pullImage(imageRepo, imageTag);
    }
  }
  logger.debug("Creating container from image", { imageRepo, imageTag });

  const repoTag = imageTag === "latest" ? imageRepo : `${imageRepo}:${imageTag}`;

  const client = new ContainerApi();
  const init: RequestInit = defaultRequestInit();

  const config: WorkspaceConfiguration = workspace.getConfiguration();

  const kafkaRestHost: string = config.get(LOCAL_KAFKA_REST_HOST, "localhost");
  const kafkaRestPort: number = config.get(LOCAL_KAFKA_REST_PORT, 8082);
  const plaintextPort: number = config.get(LOCAL_KAFKA_PLAINTEXT_PORT, 9092);

  const brokerPort: number = await findFreePort();
  const controllerPort: number = await findFreePort();
  logger.debug("Using ports", {
    plaintextPort,
    brokerPort,
    controllerPort,
  });

  // TODO: change this depending on image
  const brokerContainerName: string = "confluent-local-broker-1";

  const hostConfig = {
    NetworkMode: "confluent-local-network",
    PortBindings: {
      [`${kafkaRestPort}/tcp`]: [
        {
          HostIp: "0.0.0.0",
          HostPort: kafkaRestPort.toString(),
        },
      ],
      [`${plaintextPort}/tcp`]: [{ HostIp: "0.0.0.0", HostPort: plaintextPort.toString() }],
      [`${brokerPort}/tcp`]: [{ HostIp: "0.0.0.0", HostPort: brokerPort.toString() }],
      [`${controllerPort}/tcp`]: [{ HostIp: "0.0.0.0", HostPort: controllerPort.toString() }],
    },
  };

  const containerEnv = [
    "KAFKA_BROKER_ID=1",
    "KAFKA_LISTENER_SECURITY_PROTOCOL_MAP=CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT,PLAINTEXT_HOST:PLAINTEXT",
    `KAFKA_ADVERTISED_LISTENERS=PLAINTEXT://${brokerContainerName}:${plaintextPort},PLAINTEXT_HOST://${kafkaRestHost}:${plaintextPort}`,
    "KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR=1",
    "KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS=0",
    "KAFKA_TRANSACTION_STATE_LOG_MIN_ISR=1",
    "KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR=1",
    "KAFKA_PROCESS_ROLES=broker,controller",
    "KAFKA_NODE_ID=1",
    `KAFKA_CONTROLLER_QUORUM_VOTERS=1@${brokerContainerName}:${controllerPort}`,
    `KAFKA_LISTENERS=PLAINTEXT://${brokerContainerName}:${brokerPort},CONTROLLER://${brokerContainerName}:${controllerPort},PLAINTEXT_HOST://0.0.0.0:${plaintextPort}`,
    "KAFKA_INTER_BROKER_LISTENER_NAME=PLAINTEXT",
    "KAFKA_CONTROLLER_LISTENER_NAMES=CONTROLLER",
    "KAFKA_LOG_DIRS=/tmp/kraft-combined-logs",
    "KAFKA_REST_HOST_NAME=rest-proxy",
    `KAFKA_REST_LISTENERS=http://0.0.0.0:8082`,
    `KAFKA_REST_BOOTSTRAP_SERVERS=${brokerContainerName}:${brokerPort}`,
  ];

  // create the container before starting
  const body: ContainerCreateRequest = {
    Image: repoTag,
    Hostname: brokerContainerName,
    Cmd: ["bash", "-c", "'/etc/confluent/docker/run'"],
    ExposedPorts: {
      [`${kafkaRestPort}/tcp`]: {},
      [`${plaintextPort}/tcp`]: {},
      [`${brokerPort}/tcp`]: {},
      [`${controllerPort}/tcp`]: {},
    },
    HostConfig: hostConfig,
    Env: containerEnv,
    Tty: true,
  };
  const request: ContainerCreateOperationRequest = {
    body,
    name: brokerContainerName,
    // platform: process.platform, // TODO: determine how to provide this without raising 404s
  };
  logger.debug("Creating container with request", request);

  try {
    const response: ContainerCreateResponse = await client.containerCreate(request, init);
    logger.info("Container created successfully", response);
    return response;
  } catch (error) {
    if (error instanceof ResponseError) {
      const body = await streamToString(error.response.clone().body);

      // TODO: if port is occupied, float a notification with action to update LOCAL_KAFKA_PLAINTEXT_PORT setting

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

export async function startContainer(containerId: string) {
  const client = new ContainerApi();
  const init: RequestInit = defaultRequestInit();

  try {
    await client.containerStart({ id: containerId }, init);
  } catch (error) {
    if (error instanceof ResponseError) {
      const body = await streamToString(error.response.clone().body);
      logger.error("Error response starting container:", {
        status: error.response.status,
        statusText: error.response.statusText,
        body: body,
      });
    } else {
      logger.error("Error starting container:", error);
    }
  }
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, () => {
      const port = (server.address() as net.AddressInfo).port;
      server.close(() => resolve(port));
    });
  });
}

export class ContainerExistsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContainerExistsError";
  }
}
