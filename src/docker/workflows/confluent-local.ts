import { CancellationToken, Progress, window, workspace, WorkspaceConfiguration } from "vscode";
import { findFreePort, LocalResourceContainer, LocalResourceWorkflow } from ".";
import {
  ContainerCreateRequest,
  ContainerCreateResponse,
  ContainerInspectResponse,
  HostConfig,
} from "../../clients/docker";
import { LOCAL_KAFKA_REST_PORT } from "../../constants";
import { localKafkaConnected } from "../../emitters";
import { Logger } from "../../logging";
import { LOCAL_KAFKA_PLAINTEXT_PORT, LOCAL_KAFKA_REST_HOST } from "../../preferences/constants";
import { ContainerExistsError, createContainer, getContainer, startContainer } from "../containers";
import { createNetwork } from "../networks";

export class ConfluentLocalWorkflow extends LocalResourceWorkflow {
  static imageRepo = "confluentinc/confluent-local";
  logger = new Logger("docker.workflow.confluent-local");

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

    // TODO: determine where to put the config for number of containers (settings, quick input, etc)
    const numContainers: number = 1;
    for (let i = 1; i <= numContainers; i++) {
      const startedContainer: ContainerInspectResponse | undefined =
        await this.startLocalKafkaContainer(i);
      if (!startedContainer) {
        continue;
      }
      if (!(startedContainer.Id && startedContainer.Name)) {
        this.logger.warn("Container started without ID or name:", startedContainer);
        return;
      }
      this.containers.push({ id: startedContainer.Id, name: startedContainer.Name });
    }

    // TODO: add additional logic here for connecting with Schema Registry if a flag is set

    await this.waitForLocalResourceEventChange();
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

  /** Block until we see the {@link localKafkaConnected} event fire. (Controlled by the EventListener
   * in `src/docker/eventListener.ts` whenever a supported container starts or dies.) */
  async waitForLocalResourceEventChange(): Promise<void> {
    // not set in the base class since each workflow may need to wait for specific events to fire
    await new Promise((resolve) => {
      localKafkaConnected.event(() => {
        resolve(void 0);
      });
    });
  }

  private async startLocalKafkaContainer(
    brokerNum: number,
  ): Promise<ContainerInspectResponse | undefined> {
    const container: LocalResourceContainer | undefined =
      await this.createKafkaContainer(brokerNum);
    if (!container) {
      return;
    }
    const startContainerMsg = "Starting container...";
    this.logger.debug(startContainerMsg);
    this.progress?.report({ message: startContainerMsg });
    await startContainer(container.id);

    return await getContainer(container.id);
  }

  async createKafkaContainer(brokerNum: number): Promise<LocalResourceContainer | undefined> {
    const brokerContainerName: string = `confluent-local-broker-${brokerNum}`;

    const createContainerMsg = `Creating container ${brokerContainerName}...`;
    this.logger.debug(createContainerMsg);
    this.progress?.report({ message: createContainerMsg });

    const ports: KafkaContainerPorts = await this.configurePorts();
    const hostConfig: HostConfig = this.generateHostConfig(ports);
    const containerEnv: string[] = this.generateContainerEnv(brokerNum, brokerContainerName, ports);

    // create the container before starting
    const body: ContainerCreateRequest = {
      Image: `${ConfluentLocalWorkflow.imageRepo}:${this.imageTag}`,
      Hostname: brokerContainerName,
      Cmd: ["bash", "-c", "'/etc/confluent/docker/run'"],
      ExposedPorts: {
        [`${LOCAL_KAFKA_REST_PORT}/tcp`]: {},
        [`${ports.plainText}/tcp`]: {},
        [`${ports.broker}/tcp`]: {},
        [`${ports.controller}/tcp`]: {},
      },
      HostConfig: hostConfig,
      Env: containerEnv,
      Tty: true,
    };

    try {
      const container: ContainerCreateResponse | undefined = await createContainer(
        ConfluentLocalWorkflow.imageRepo,
        this.imageTag,
        {
          body,
          name: brokerContainerName,
        },
      );
      if (!container) {
        window.showErrorMessage("Failed to create Kafka container.");
        return;
      }
      return { id: container.Id, name: brokerContainerName };
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

  /**
   * Configure the ports to use for a Kafka container.
   *
   * The plaintext port is configurable by the user, but the broker and controller ports are dynamically
   * assigned based on available ports on the host machine.
   */
  private async configurePorts(): Promise<KafkaContainerPorts> {
    const plainText: number = workspace.getConfiguration().get(LOCAL_KAFKA_PLAINTEXT_PORT, 9092);
    const broker: number = await findFreePort();
    const controller: number = await findFreePort();
    this.logger.debug("Using ports", {
      plainText,
      broker,
      controller,
    });
    return { plainText, broker, controller };
  }

  /** Generate the HostConfig for a Kafka container using provided ports and this workflow's network name. */
  private generateHostConfig(ports: KafkaContainerPorts): HostConfig {
    return {
      NetworkMode: this.networkName,
      PortBindings: {
        [`${LOCAL_KAFKA_REST_PORT}/tcp`]: [
          {
            HostIp: "0.0.0.0",
            HostPort: LOCAL_KAFKA_REST_PORT.toString(),
          },
        ],
        [`${ports.plainText}/tcp`]: [{ HostIp: "0.0.0.0", HostPort: ports.plainText.toString() }],
        [`${ports.broker}/tcp`]: [{ HostIp: "0.0.0.0", HostPort: ports.broker.toString() }],
        [`${ports.controller}/tcp`]: [{ HostIp: "0.0.0.0", HostPort: ports.controller.toString() }],
      },
    };
  }

  private generateContainerEnv(
    brokerNum: number,
    brokerContainerName: string,
    ports: KafkaContainerPorts,
  ): string[] {
    const config: WorkspaceConfiguration = workspace.getConfiguration();
    // TODO: determine if this needs to be configurable (i.e. for WSL)
    const kafkaRestHost: string = config.get(LOCAL_KAFKA_REST_HOST, "localhost");
    return [
      `KAFKA_ADVERTISED_LISTENERS=PLAINTEXT://${brokerContainerName}:${ports.plainText},PLAINTEXT_HOST://${kafkaRestHost}:${ports.plainText}`,
      `KAFKA_BROKER_ID=${brokerNum}`,
      "KAFKA_CONTROLLER_LISTENER_NAMES=CONTROLLER",
      `KAFKA_CONTROLLER_QUORUM_VOTERS=1@${brokerContainerName}:${ports.controller}`,
      "KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS=0",
      "KAFKA_INTER_BROKER_LISTENER_NAME=PLAINTEXT",
      "KAFKA_LISTENER_SECURITY_PROTOCOL_MAP=CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT,PLAINTEXT_HOST:PLAINTEXT",
      `KAFKA_LISTENERS=PLAINTEXT://${brokerContainerName}:${ports.broker},CONTROLLER://${brokerContainerName}:${ports.controller},PLAINTEXT_HOST://0.0.0.0:${ports.plainText}`,
      "KAFKA_LOG_DIRS=/tmp/kraft-combined-logs",
      "KAFKA_NODE_ID=1",
      "KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR=1",
      "KAFKA_PROCESS_ROLES=broker,controller",
      `KAFKA_REST_BOOTSTRAP_SERVERS=${brokerContainerName}:${ports.broker}`,
      "KAFKA_REST_HOST_NAME=rest-proxy",
      `KAFKA_REST_LISTENERS=http://0.0.0.0:${LOCAL_KAFKA_REST_PORT}`,
      "KAFKA_TRANSACTION_STATE_LOG_MIN_ISR=1",
      "KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR=1",
    ];
  }
}

interface KafkaContainerPorts {
  plainText: number;
  broker: number;
  controller: number;
}
