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
  stopContainer,
} from "../containers";
import { createNetwork } from "../networks";

const CONTAINER_NAME_PREFIX = "vscode-confluent-local-broker";

export class ConfluentLocalWorkflow extends LocalResourceWorkflow {
  resourceKind: string = "Kafka";
  static imageRepo = "confluentinc/confluent-local";

  logger = new Logger("docker.workflow.confluent-local");

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
   * - Check for existing containers and exit early if found
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
    await this.checkForImage(this.imageRepo, this.imageTag);
    if (token.isCancellationRequested) return;

    const containerListRequest: ContainerListRequest = {
      all: true,
      filters: JSON.stringify({
        ancestor: [this.imageRepoTag],
        label: [MANAGED_CONTAINER_LABEL],
      }),
    };
    const existingContainers: ContainerSummary[] =
      await getContainersForImage(containerListRequest);
    if (existingContainers.length > 0) {
      // this will handle logging and notifications
      await this.handleExistingContainers(existingContainers);
      return;
    }

    this.logAndUpdateProgress(`Creating "${this.networkName}" network...`);
    await createNetwork(this.networkName);
    if (token.isCancellationRequested) return;

    this.logAndUpdateProgress("Preparing for broker container creation...");
    let count: number = 1;
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
    count = parseInt(numContainersString, 10);
    const plural = count > 1 ? "s" : "";
    this.sendTelemetryEvent("Input Box Filled", {
      numContainers: count,
      purpose: "Kafka Broker/Container Count",
    });
    if (token.isCancellationRequested) return;

    this.logger.debug(`starting/creating ${count} broker container${plural}`);
    const brokerConfigs: KafkaBrokerConfig[] = await this.generateBrokerConfigs(count);
    const allContainerEnvs: string[][] = brokerConfigs.map((brokerConfig): string[] =>
      this.generateContainerEnv(brokerConfig.brokerNum, brokerConfigs),
    );
    this.logAndUpdateProgress(`Starting ${count} ${this.resourceKind} container${plural}...`);

    // if any of the containers fail to create or start, we'll stop early and won't wait for local
    // resource event change
    let success: boolean = true;
    for (const brokerConfig of brokerConfigs) {
      if (token.isCancellationRequested) {
        success = false;
        break;
      }
      // get the environment variables for this broker container based on its number before creating
      const containerEnvs: string[] = allContainerEnvs[brokerConfig.brokerNum - 1];
      // create the container first
      const container: LocalResourceContainer | undefined = await this.createKafkaContainer(
        brokerConfig,
        containerEnvs,
      );
      if (!container) {
        this.showErrorNotification(
          `Failed to create ${this.resourceKind} container "${brokerConfig.containerName}".`,
        );
        success = false;
        break;
      }
      this.sendTelemetryEvent("Docker Container Created", {
        dockerContainerName: container.name,
      });
      // then start the container
      const startedContainer: ContainerInspectResponse | undefined =
        await this.startKafkaContainer(container);
      if (!startedContainer) {
        this.showErrorNotification(
          `Failed to start ${this.resourceKind} container "${container.name}".`,
        );
        success = false;
        break;
      }
      this.sendTelemetryEvent("Docker Container Started", {
        dockerContainerName: container.name,
      });
    }
    // can't wait for containers to be ready if they didn't start
    if (!success) return;

    this.logAndUpdateProgress(`Waiting for ${this.resourceKind} container${plural} to be ready...`);
    await this.waitForLocalResourceEventChange();
  }

  /** Stop `confluent-local` container(s). */
  async stop(
    token: CancellationToken,
    progress?: Progress<{ message?: string; increment?: number }>,
  ): Promise<void> {
    this.progress = progress;
    this.logger.debug(`Stopping "confluent-local" workflow...`);
    const containers: ContainerSummary[] = await getContainersForImage(
      ConfluentLocalWorkflow.imageRepo,
      this.imageTag,
    );
    if (containers.length === 0) {
      return;
    }

    const promises: Promise<void>[] = [];
    for (const container of containers) {
      if (!container.Id || !container.Names) {
        this.logger.error("Container missing ID or name", {
          id: container.Id,
          names: container.Names,
        });
        continue;
      }
      promises.push(this.stopContainer({ id: container.Id, name: container.Names[0] }));
    }

    await this.waitForLocalResourceEventChange();
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

  /** Create a Kafka container with the provided broker configuration and environment variables. */
  async createKafkaContainer(
    brokerConfig: KafkaBrokerConfig,
    envVars: string[],
  ): Promise<LocalResourceContainer | undefined> {
    const { containerName, ports } = brokerConfig;
    this.logAndUpdateProgress(`Creating ${this.resourceKind} container "${containerName}"...`);

    const hostConfig: HostConfig = this.generateHostConfig(brokerConfig);
    const body: ContainerCreateRequest = {
      Image: this.imageRepoTag,
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
      this.imageRepo,
      this.imageTag,
      {
        body,
        name: containerName,
      },
    );
    return container ? { id: container.Id, name: containerName } : undefined;
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

  /** Start the provided Kafka container and return its {@link ContainerInspectResponse}. */
  private async startKafkaContainer(
    container: LocalResourceContainer,
  ): Promise<ContainerInspectResponse | undefined> {
    await startContainer(container.id);
    return await getContainer(container.id);
  }

  private async stopContainer(container: LocalResourceContainer): Promise<void> {
    // check container status before deleting
    this.progress?.report({ message: `Stopping container "${container.name}"...` });
    const existingContainer: ContainerInspectResponse | undefined = await getContainer(
      container.id,
    );
    if (!existingContainer) {
      // assume it was cleaned up some other way
      this.logger.warn("Container not found, skipping stop and delete steps.", {
        id: container.id,
        name: container.name,
      });
      return;
    }

    if (existingContainer.State?.Status === "running") {
      await stopContainer(container.id);
    }
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
function validateBrokerInput(userInput: string): InputBoxValidationMessage | undefined {
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