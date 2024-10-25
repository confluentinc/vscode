import {
  CancellationToken,
  InputBoxValidationMessage,
  InputBoxValidationSeverity,
  Progress,
  window,
  workspace,
  WorkspaceConfiguration,
} from "vscode";
import { findFreePort, LocalResourceContainer, LocalResourceWorkflow } from ".";
import {
  ContainerCreateRequest,
  ContainerCreateResponse,
  ContainerInspectResponse,
  ContainerListRequest,
  ContainerSummary,
  HostConfig,
} from "../../clients/docker";
import { LOCAL_KAFKA_REST_PORT } from "../../constants";
import { localKafkaConnected } from "../../emitters";
import { Logger } from "../../logging";
import { LOCAL_KAFKA_REST_HOST } from "../../preferences/constants";
import { getLocalKafkaImageTag } from "../configs";
import { MANAGED_CONTAINER_LABEL } from "../constants";
import {
  createContainer,
  getContainer,
  getContainersForImage,
  startContainer,
} from "../containers";
import { createNetwork } from "../networks";

const CONTAINER_NAME_PREFIX = "vscode-confluent-local-broker";

export class ConfluentLocalWorkflow extends LocalResourceWorkflow {
  static imageRepo = "confluentinc/confluent-local";

  logger = new Logger("docker.workflow.confluent-local");

  networkName: string = "vscode-confluent-local-network";

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
   * - Create the container(s) for the Kafka broker(s)
   * - Start the container(s)
   * - Wait for the container(s) to be ready
   */
  async start(
    token: CancellationToken,
    progress?: Progress<{ message?: string; increment?: number }>,
  ): Promise<void> {
    this.progress = progress;
    this.imageTag = getLocalKafkaImageTag();

    // already handles logging + updating the progress notification
    await this.checkForImage();

    const repoTag = `${ConfluentLocalWorkflow.imageRepo}:${this.imageTag}`;
    const listImagesRequest: ContainerListRequest = {
      all: true,
      filters: JSON.stringify({
        ancestor: [repoTag],
        label: [MANAGED_CONTAINER_LABEL],
      }),
    };
    const existingContainers: ContainerSummary[] = await getContainersForImage(listImagesRequest);
    if (existingContainers.length > 0) {
      window.showWarningMessage(
        "Existing Kafka container(s) found. Please stop and remove them before starting new ones.",
      );
      return;
    }

    const createNetworkMsg = `Creating "${this.networkName}" network...`;
    this.logger.debug(createNetworkMsg);
    this.progress?.report({ message: createNetworkMsg });
    await createNetwork(this.networkName);

    const prepMsg = "Preparing for broker container creation...";
    this.logger.debug(prepMsg);
    this.progress?.report({ message: prepMsg });
    let numContainers: number = 1;
    const numContainersString: string | undefined = await window.showInputBox({
      title: "Start Confluent Local",
      prompt: "Enter the number of Kafka brokers to start (1-4)",
      placeHolder: "1",
      value: "1",
      ignoreFocusOut: true,
      validateInput: validateBrokerInput,
    });
    if (numContainersString === undefined) {
      // early exit if the user cancels the input box
      return;
    }
    numContainers = parseInt(numContainersString, 10);
    this.logger.debug(`starting/creating ${numContainers} broker container(s)`);

    const brokerConfigs: KafkaBrokerConfig[] = await this.generateBrokerConfigs(numContainers);
    const allContainerEnvs: string[][] = brokerConfigs.map((brokerConfig): string[] =>
      this.generateContainerEnv(brokerConfig.brokerNum, brokerConfigs),
    );

    let success: boolean = true;
    for (const brokerConfig of brokerConfigs) {
      // get the environment variables for this broker container based on its number before starting
      const containerEnvs: string[] = allContainerEnvs[brokerConfig.brokerNum - 1];
      const startedContainer: ContainerInspectResponse | undefined =
        await this.startLocalKafkaContainer(brokerConfig, containerEnvs);
      if (!startedContainer) {
        success = false;
        break;
      }
    }
    if (!success) {
      return;
    }

    const waitMsg = `Waiting for container${numContainers > 1 ? "s" : ""} to be ready...`;
    this.logger.debug(waitMsg);
    this.progress?.report({ message: waitMsg });
    await this.waitForLocalResourceEventChange();
  }

  /** Stop `confluent-local` container(s). */
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
    await new Promise((resolve) => {
      localKafkaConnected.event(() => {
        resolve(void 0);
      });
    });
  }

  /** Start a Kafka container with the provided broker configuration and environment variables. */
  private async startLocalKafkaContainer(
    brokerConfig: KafkaBrokerConfig,
    envVars: string[],
  ): Promise<ContainerInspectResponse | undefined> {
    const container: LocalResourceContainer | undefined = await this.createKafkaContainer(
      brokerConfig,
      envVars,
    );
    if (!container) {
      return;
    }
    const startContainerMsg = `Starting container "${brokerConfig.containerName}"...`;
    this.logger.debug(startContainerMsg);
    this.progress?.report({ message: startContainerMsg });
    await startContainer(container.id);

    const startedContainer: ContainerInspectResponse | undefined = await getContainer(container.id);
    if (!startedContainer) {
      window
        .showErrorMessage(
          `Failed to start Kafka container "${brokerConfig.containerName}".`,
          "Open Logs",
        )
        .then(this.handleOpenLogsButton);
    }
    return startedContainer;
  }

  /** Create a Kafka container with the provided broker configuration and environment variables. */
  async createKafkaContainer(
    brokerConfig: KafkaBrokerConfig,
    envVars: string[],
  ): Promise<LocalResourceContainer | undefined> {
    const { containerName, ports } = brokerConfig;

    const createContainerMsg = `Creating container "${containerName}"...`;
    this.logger.debug(createContainerMsg);
    this.progress?.report({ message: createContainerMsg });

    const hostConfig: HostConfig = this.generateHostConfig(brokerConfig);

    // create the container before starting
    const body: ContainerCreateRequest = {
      Image: `${ConfluentLocalWorkflow.imageRepo}:${this.imageTag}`,
      Hostname: containerName,
      Cmd: ["bash", "-c", "'/etc/confluent/docker/run'"],
      ExposedPorts: {
        [`${ports.plainText}/tcp`]: {},
      },
      HostConfig: hostConfig,
      Env: envVars,
      Tty: false,
    };

    const container: ContainerCreateResponse | undefined = await createContainer(
      ConfluentLocalWorkflow.imageRepo,
      this.imageTag,
      {
        body,
        name: containerName,
      },
    );
    if (!container) {
      window
        .showErrorMessage(`Failed to create Kafka container "${containerName}".`, "Open Logs")
        .then(this.handleOpenLogsButton);
      return;
    }
    return { id: container.Id, name: containerName };
  }

  /** Generate the broker configurations for the number of brokers specified. */
  private async generateBrokerConfigs(numBrokers: number): Promise<KafkaBrokerConfig[]> {
    const brokerConfigs: KafkaBrokerConfig[] = [];
    for (let i = 1; i <= numBrokers; i++) {
      const containerName = `${CONTAINER_NAME_PREFIX}-${i}`;
      const ports: KafkaContainerPorts = await this.configurePorts();
      brokerConfigs.push({ brokerNum: i, containerName, ports });
    }
    return brokerConfigs;
  }

  /**
   * Configure the ports to use for a Kafka container.
   *
   * The plaintext port is configurable by the user, but the broker and controller ports are dynamically
   * assigned based on available ports on the host machine.
   */
  private async configurePorts(): Promise<KafkaContainerPorts> {
    const plainText: number = await findFreePort();
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
  private generateHostConfig(brokerConfig: KafkaBrokerConfig): HostConfig {
    const ports: KafkaContainerPorts = brokerConfig.ports;
    const portBindings = {
      [`${ports.plainText}/tcp`]: [{ HostIp: "0.0.0.0", HostPort: ports.plainText.toString() }],
    };
    // only expose the REST port on the first broker
    if (brokerConfig.brokerNum === 1) {
      portBindings[`${LOCAL_KAFKA_REST_PORT}/tcp`] = [
        {
          HostIp: "0.0.0.0",
          HostPort: LOCAL_KAFKA_REST_PORT.toString(),
        },
      ];
    }
    const hostConfig: HostConfig = {
      NetworkMode: this.networkName,
      PortBindings: portBindings,
    };
    return hostConfig;
  }

  /** Generate the environment variables for a Kafka container based on the broker number, its config,
   * and any other configs (if multiple brokers are used). */
  private generateContainerEnv(brokerNum: number, brokerConfigs: KafkaBrokerConfig[]): string[] {
    // look up this specific broker's config
    const brokerConfig: KafkaBrokerConfig | undefined = brokerConfigs.find(
      (config) => config.brokerNum === brokerNum,
    );
    if (!brokerConfig) {
      throw new Error(`No broker config found for broker ${brokerNum}`);
    }

    const controllerQuorumVoters: string[] = brokerConfigsToControllerQuorumVoters(brokerConfigs);
    const restBootstrapServers: string[] = brokerConfigsToRestBootstrapServers(brokerConfigs);

    const config: WorkspaceConfiguration = workspace.getConfiguration();
    // TODO: determine if this needs to be configurable (i.e. for WSL)
    const kafkaRestHost: string = config.get(LOCAL_KAFKA_REST_HOST, "localhost");

    // containerName matches hostname, see `body` up in `createKafkaContainer()`
    const containerName: string = brokerConfig.containerName;
    const ports: KafkaContainerPorts = brokerConfig.ports;

    const envVars = [
      `KAFKA_ADVERTISED_LISTENERS=PLAINTEXT://${containerName}:${ports.broker},PLAINTEXT_HOST://${kafkaRestHost}:${ports.plainText}`,
      `KAFKA_BROKER_ID=${brokerNum}`,
      "KAFKA_CONTROLLER_LISTENER_NAMES=CONTROLLER",
      `KAFKA_CONTROLLER_QUORUM_VOTERS=${controllerQuorumVoters.join(",")}`,
      "KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS=0",
      "KAFKA_INTER_BROKER_LISTENER_NAME=PLAINTEXT",
      "KAFKA_LISTENER_SECURITY_PROTOCOL_MAP=CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT,PLAINTEXT_HOST:PLAINTEXT",
      `KAFKA_LISTENERS=PLAINTEXT://${containerName}:${ports.broker},CONTROLLER://${containerName}:${ports.controller},PLAINTEXT_HOST://0.0.0.0:${ports.plainText}`,
      "KAFKA_LOG_DIRS=/tmp/kraft-combined-logs",
      `KAFKA_NODE_ID=${brokerNum}`,
      "KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR=1",
      "KAFKA_PROCESS_ROLES=broker,controller",
      "KAFKA_REST_HOST_NAME=rest-proxy",
      "KAFKA_TRANSACTION_STATE_LOG_MIN_ISR=1",
      "KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR=1",
    ];
    if (brokerNum === 1) {
      envVars.push(
        `KAFKA_REST_BOOTSTRAP_SERVERS=${restBootstrapServers.join(",")}`,
        `KAFKA_REST_LISTENERS=http://0.0.0.0:${LOCAL_KAFKA_REST_PORT}`,
      );
    }
    return envVars;
  }
}

/** Convert an array of broker configs to a list of controller quorum voter strings. */
function brokerConfigsToControllerQuorumVoters(configs: KafkaBrokerConfig[]): string[] {
  return configs.map(
    (config) => `${config.brokerNum}@${config.containerName}:${config.ports.controller}`,
  );
}

/** Convert an array of broker configs to a list of REST bootstrap server strings. */
function brokerConfigsToRestBootstrapServers(configs: KafkaBrokerConfig[]): string[] {
  return configs.map((config) => `${config.containerName}:${config.ports.broker}`);
}

/** Validate the user's input for the number of brokers/containers to start. */
function validateBrokerInput(userInput: string): string | InputBoxValidationMessage | undefined {
  const num: number = parseInt(userInput, 10);
  if (isNaN(num) || num < 1 || num > 4) {
    return {
      message: "Please enter a number between 1 and 4 (inclusive)",
      severity: InputBoxValidationSeverity.Error,
    };
  }
  return;
}

interface KafkaContainerPorts {
  plainText: number;
  broker: number;
  controller: number;
}

interface KafkaBrokerConfig {
  brokerNum: number;
  containerName: string;
  ports: KafkaContainerPorts;
}
