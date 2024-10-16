import { CancellationToken, Progress, window, workspace, WorkspaceConfiguration } from "vscode";
import { findFreePort, LocalResourceWorkflow } from ".";
import {
  ContainerCreateOperationRequest,
  ContainerCreateRequest,
  ContainerCreateResponse,
} from "../../clients/docker";
import { localKafkaConnected } from "../../emitters";
import { Logger } from "../../logging";
import {
  LOCAL_KAFKA_PLAINTEXT_PORT,
  LOCAL_KAFKA_REST_HOST,
  LOCAL_KAFKA_REST_PORT,
} from "../../preferences/constants";
import { ContainerExistsError, createContainer, startContainer } from "../containers";
import { createNetwork } from "../networks";

export class ConfluentLocalWorkflow extends LocalResourceWorkflow {
  static imageRepo = "confluentinc/confluent-local";
  logger = new Logger("docker.workflow.confluent-local");

  brokerContainerName: string = "confluent-local-broker-1";
  networkName: string = "confluent-local-network";

  // ensure only one instance of this workflow can run at a time
  private static instance: ConfluentLocalWorkflow;
  private constructor() {
    super(); // must call super() in derived class constructor
  }
  static getInstance(): ConfluentLocalWorkflow {
    if (!ConfluentLocalWorkflow.instance) {
      ConfluentLocalWorkflow.instance = new ConfluentLocalWorkflow();
    }
    return ConfluentLocalWorkflow.instance;
  }

  /**
   * Start `confluent-local` resources locally:
   * - Ensure the Docker image is available
   * - Create a network if it doesn't exist
   * - Create a container
   * - Start the container
   * - Wait for the container to be connected
   */
  async start(
    token: CancellationToken,
    progress?: Progress<{ message?: string; increment?: number }>,
  ): Promise<void> {
    this.progress = progress;
    this.logger.debug(`Starting "confluent-local" workflow...`);

    // already handles logging + updating the progress notification
    await this.checkForImage();

    const createNetworkMsg = `Creating "${this.networkName}" network...`;
    this.logger.debug(createNetworkMsg);
    this.progress?.report({ message: createNetworkMsg });
    await createNetwork(this.networkName);

    const containerId: string | undefined = await this.createKafkaContainer();
    if (!containerId) {
      return;
    }

    const startContainerMsg = "Starting container...";
    this.logger.debug(startContainerMsg);
    this.progress?.report({ message: startContainerMsg });
    await startContainer(containerId);

    // TODO: add additional logic here for connecting with Schema Registry if a flag is set

    await this.waitForConnectionChangeEvent();
  }

  /**
   * Stop and remove `confluent-local` resources:
   * - Stop the container
   * - Remove the container
   * - Remove the network
   */
  async stop(
    token: CancellationToken,
    progress?: Progress<{ message?: string; increment?: number }>,
  ): Promise<void> {
    this.progress = progress;
    this.logger.debug("Stopping ...");
    // TODO(shoup): implement
  }

  async waitForConnectionChangeEvent(): Promise<void> {
    await new Promise((resolve) => {
      localKafkaConnected.event(() => {
        resolve(void 0);
      });
    });
  }

  get plainTextPort(): number {
    return workspace.getConfiguration().get(LOCAL_KAFKA_PLAINTEXT_PORT, 9092);
  }

  async createKafkaContainer(): Promise<string | undefined> {
    const createContainerMsg = "Creating container...";
    this.logger.debug(createContainerMsg);
    this.progress?.report({ message: createContainerMsg });

    const config: WorkspaceConfiguration = workspace.getConfiguration();

    // TODO: determine if this needs to be configurable (i.e. for WSL)
    const kafkaRestHost: string = config.get(LOCAL_KAFKA_REST_HOST, "localhost");

    const brokerPort: number = await findFreePort();
    const controllerPort: number = await findFreePort();
    this.logger.debug("Using ports", {
      plaintextPort: this.plainTextPort,
      brokerPort,
      controllerPort,
    });

    const hostConfig = {
      NetworkMode: this.networkName,
      PortBindings: {
        [`${LOCAL_KAFKA_REST_PORT}/tcp`]: [
          {
            HostIp: "0.0.0.0",
            HostPort: LOCAL_KAFKA_REST_PORT.toString(),
          },
        ],
        [`${this.plainTextPort}/tcp`]: [
          { HostIp: "0.0.0.0", HostPort: this.plainTextPort.toString() },
        ],
        [`${brokerPort}/tcp`]: [{ HostIp: "0.0.0.0", HostPort: brokerPort.toString() }],
        [`${controllerPort}/tcp`]: [{ HostIp: "0.0.0.0", HostPort: controllerPort.toString() }],
      },
    };

    const containerEnv = [
      "KAFKA_BROKER_ID=1",
      "KAFKA_LISTENER_SECURITY_PROTOCOL_MAP=CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT,PLAINTEXT_HOST:PLAINTEXT",
      `KAFKA_ADVERTISED_LISTENERS=PLAINTEXT://${this.brokerContainerName}:${this.plainTextPort},PLAINTEXT_HOST://${kafkaRestHost}:${this.plainTextPort}`,
      "KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR=1",
      "KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS=0",
      "KAFKA_TRANSACTION_STATE_LOG_MIN_ISR=1",
      "KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR=1",
      "KAFKA_PROCESS_ROLES=broker,controller",
      "KAFKA_NODE_ID=1",
      `KAFKA_CONTROLLER_QUORUM_VOTERS=1@${this.brokerContainerName}:${controllerPort}`,
      `KAFKA_LISTENERS=PLAINTEXT://${this.brokerContainerName}:${brokerPort},CONTROLLER://${this.brokerContainerName}:${controllerPort},PLAINTEXT_HOST://0.0.0.0:${this.plainTextPort}`,
      "KAFKA_INTER_BROKER_LISTENER_NAME=PLAINTEXT",
      "KAFKA_CONTROLLER_LISTENER_NAMES=CONTROLLER",
      "KAFKA_LOG_DIRS=/tmp/kraft-combined-logs",
      "KAFKA_REST_HOST_NAME=rest-proxy",
      `KAFKA_REST_LISTENERS=http://0.0.0.0:${LOCAL_KAFKA_REST_PORT}`,
      `KAFKA_REST_BOOTSTRAP_SERVERS=${this.brokerContainerName}:${brokerPort}`,
    ];

    // create the container before starting
    const body: ContainerCreateRequest = {
      Image: `${ConfluentLocalWorkflow.imageRepo}:${this.imageTag}`,
      Hostname: this.brokerContainerName,
      Cmd: ["bash", "-c", "'/etc/confluent/docker/run'"],
      ExposedPorts: {
        [`${LOCAL_KAFKA_REST_PORT}/tcp`]: {},
        [`${this.plainTextPort}/tcp`]: {},
        [`${brokerPort}/tcp`]: {},
        [`${controllerPort}/tcp`]: {},
      },
      HostConfig: hostConfig,
      Env: containerEnv,
      Tty: true,
    };

    const request: ContainerCreateOperationRequest = {
      body,
      name: this.brokerContainerName,
    };

    try {
      const container: ContainerCreateResponse | undefined = await createContainer(
        ConfluentLocalWorkflow.imageRepo,
        this.imageTag,
        request,
      );
      if (!container) {
        window.showErrorMessage("Failed to create Kafka container.");
        return;
      }
      return container.Id;
    } catch (error) {
      if (error instanceof ContainerExistsError) {
        // TODO(shoup): add buttons for (re)start / delete container in follow-on branch
        window.showWarningMessage(
          "Local Kafka container already exists. Please remove it and try again.",
        );
      } else {
        this.logger.error("Error creating container:", error);
      }
      return;
    }
  }
}
