import { CancellationToken, commands, Progress, window } from "vscode";
import { findFreePort, LocalResourceContainer, LocalResourceWorkflow } from ".";
import {
  ContainerCreateRequest,
  ContainerCreateResponse,
  ContainerInspectResponse,
  ContainerListRequest,
  ContainerSummary,
  HostConfig,
} from "../../clients/docker";
import { getKafkaWorkflow } from "../../commands/docker";
import { localSchemaRegistryConnected } from "../../emitters";
import { Logger } from "../../logging";
import { updateLocalSchemaRegistryURI } from "../../sidecar/connections";
import { getLocalKafkaImageName, getLocalSchemaRegistryImageTag } from "../configs";
import { MANAGED_CONTAINER_LABEL } from "../constants";
import {
  createContainer,
  getContainer,
  getContainerEnvVars,
  getContainerPorts,
  getContainersForImage,
  startContainer,
  stopContainer,
} from "../containers";

const CONTAINER_NAME = "vscode-confluent-schema-registry";

export class ConfluentPlatformSchemaRegistryWorkflow extends LocalResourceWorkflow {
  resourceKind: string = "Schema Registry";
  static imageRepo = "confluentinc/cp-schema-registry";

  logger = new Logger("docker.workflow.cp-schema-registry");

  // ensure only one instance of this workflow can run at a time
  private static instance: ConfluentPlatformSchemaRegistryWorkflow;
  private constructor() {
    super(); // must call super() in derived class constructor
  }
  static getInstance(): ConfluentPlatformSchemaRegistryWorkflow {
    if (!ConfluentPlatformSchemaRegistryWorkflow.instance) {
      ConfluentPlatformSchemaRegistryWorkflow.instance =
        new ConfluentPlatformSchemaRegistryWorkflow();
    }
    return ConfluentPlatformSchemaRegistryWorkflow.instance;
  }

  /**
   * Start a `cp-schema-registry` container locally:
   * - Ensure the Docker image is available
   * - List existing Kafka broker containers based on the user-configured image repo+tag
   * - Look up the network and bootstrap server environment variables
   * - Create and start the Schema Registry container
   * - Wait for the container to be ready
   */
  async start(
    token: CancellationToken,
    progress?: Progress<{ message?: string; increment?: number }>,
  ): Promise<void> {
    this.progress = progress;
    this.imageTag = getLocalSchemaRegistryImageTag();

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

    this.logAndUpdateProgress(`Checking for Kafka containers...`);
    const kafkaContainers = await this.fetchAndFilterKafkaContainers();
    if (kafkaContainers.length === 0) {
      this.logger.error("no Kafka containers found, skipping creation");
      const buttonLabel = "Start Local Resources";
      window
        .showErrorMessage(
          "No running Kafka containers found. Please start Kafka and try again.",
          buttonLabel,
        )
        .then((selection) => {
          if (selection === buttonLabel) {
            commands.executeCommand("confluent.docker.startLocalResources");
            this.sendTelemetryEvent("Notification Button Clicked", {
              buttonLabel: buttonLabel,
              notificationType: "error",
              purpose: "No Kafka Containers Found",
            });
          }
        });
      return;
    }
    // inspect the containers to get the Docker network name and boostrap server host+port combos
    const kafkaNetworks: string[] = this.determineKafkaDockerNetworks(kafkaContainers);
    const kafkaBootstrapServers = await this.determineKafkaBootstrapServers(kafkaContainers);
    this.logger.debug("Kafka container(s) found", {
      count: kafkaContainers.length,
      bootstrapServers: kafkaBootstrapServers,
      networks: kafkaNetworks,
    });
    if (token.isCancellationRequested) return;

    // create the SR container
    const container: LocalResourceContainer | undefined = await this.createSchemaRegistryContainer(
      kafkaBootstrapServers,
      kafkaNetworks,
    );
    if (!container) {
      this.showErrorNotification(`Failed to create ${this.resourceKind} container.`);
      return;
    }
    this.sendTelemetryEvent("Docker Container Created", {
      dockerContainerName: container.name,
    });
    if (token.isCancellationRequested) return;

    // start the SR container
    this.logAndUpdateProgress(`Starting container "${container.name}"...`);
    await startContainer(container.id);
    const startedContainer: ContainerInspectResponse = await getContainer(container.id);
    if (!startedContainer) {
      this.showErrorNotification(
        `Failed to start ${this.resourceKind} container "${container.name}".`,
      );
      return;
    }
    this.sendTelemetryEvent("Docker Container Started", {
      dockerContainerName: container.name,
    });
    if (!startedContainer || token.isCancellationRequested) {
      return;
    }

    this.logAndUpdateProgress(`Waiting for ${this.resourceKind} container to be ready...`);
    await this.waitForLocalResourceEventChange();
  }

  /** Stop Schema Registry container. */
  async stop(
    token: CancellationToken,
    progress?: Progress<{ message?: string; increment?: number }>,
  ): Promise<void> {
    this.progress = progress;

    const repoTag = `${ConfluentPlatformSchemaRegistryWorkflow.imageRepo}:${this.imageTag}`;
    const containerListRequest: ContainerListRequest = {
      all: true,
      filters: JSON.stringify({
        ancestor: [repoTag],
        label: [MANAGED_CONTAINER_LABEL],
      }),
    };
    const existingContainers: ContainerSummary[] =
      await getContainersForImage(containerListRequest);
    if (existingContainers.length === 0) {
      return;
    }

    this.logAndUpdateProgress(
      `Stopping ${existingContainers.length} ${this.resourceKind} container(s)...`,
    );
    const promises: Promise<void>[] = [];
    for (const container of existingContainers) {
      if (!container.Id || !container.Names) {
        this.logger.error("Container missing ID or name", {
          id: container.Id,
          names: container.Names,
        });
        continue;
      }
      promises.push(
        this.stopSchemaRegistryContainer({ id: container.Id, name: container.Names[0] }),
      );
    }
    await Promise.all(promises);

    // only allow exiting from here since awaiting each stopContainer() call and allowing cancellation
    // there would introduce a delay
    if (token.isCancellationRequested) return;

    await this.waitForLocalResourceEventChange();
  }

  /** Block until we see the {@link localSchemaRegistryConnected} event fire. (Controlled by the
   * EventListener in `src/docker/eventListener.ts` whenever a supported container starts or dies.) */
  async waitForLocalResourceEventChange(): Promise<void> {
    await new Promise((resolve) => {
      localSchemaRegistryConnected.event(() => {
        resolve(void 0);
      });
    });
  }

  /** List existing Kafka broker containers by user-configurable image repo+tag, then
   * return the container-inspect responses. */
  async fetchAndFilterKafkaContainers(): Promise<ContainerInspectResponse[]> {
    const kafkaWorkflow: LocalResourceWorkflow | undefined = getKafkaWorkflow();
    if (!kafkaWorkflow) {
      this.logger.error("Unable to look up Kafka image from workflow.");
      return [];
    }

    const kafkaImageRepo: string = getLocalKafkaImageName();
    const kafkaImageTag: string = kafkaWorkflow.imageTag;

    // TEMPORARY: this will go away once we start working with direct connections
    // ---
    // first, look for a container with the Kafka REST proxy port exposed (8082),
    // then use that network to find any other Kafka broker containers
    const leaderListRequest: ContainerListRequest = {
      filters: JSON.stringify({
        ancestor: [`${kafkaImageRepo}:${kafkaImageTag}`],
        expose: ["8082"],
      }),
    };
    const leaderContainers: ContainerSummary[] = await getContainersForImage(leaderListRequest);

    const containerSummaries: ContainerSummary[] = [];
    if (leaderContainers.length > 0) {
      // shouldn't have more than one with exposed REST proxy port
      const leaderContainer: ContainerSummary = leaderContainers[0];
      const containerListFilters: Record<string, string[]> = {
        ancestor: [`${kafkaImageRepo}:${kafkaImageTag}`],
        // label: [MANAGED_CONTAINER_LABEL],
      };
      if (leaderContainer.HostConfig?.NetworkMode) {
        containerListFilters.network = [leaderContainer.HostConfig.NetworkMode];
      }
      // don't set `all: true` here because we only want running containers
      const containerListFiltersRequest: ContainerListRequest = {
        filters: JSON.stringify(containerListFilters),
      };
      // fetch container summaries for other associated Kafka containers first, then inspect them
      // since we'll need to look up env vars and ports later
      const summaries: ContainerSummary[] = await getContainersForImage(
        containerListFiltersRequest,
      );
      containerSummaries.push(...summaries);
    }

    // either there was no leader container or we couldn't find any other containers
    if (containerSummaries.length === 0) {
      return [];
    }

    const kafkaContainers: ContainerInspectResponse[] = [];
    const inspectPromises: Promise<ContainerInspectResponse | undefined>[] = [];
    containerSummaries.forEach((container) => {
      if (!container.Id) {
        return;
      }
      inspectPromises.push(getContainer(container.Id));
    });
    (await Promise.all(inspectPromises)).forEach(
      (response: ContainerInspectResponse | undefined) => {
        if (response) kafkaContainers.push(response);
      },
    );

    // TODO: inspect ports and do filtering by network?
    const kafkaPorts = kafkaContainers.map((container) => getContainerPorts(container));
    this.logger.debug("Kafka container ports:", kafkaPorts);

    return kafkaContainers;
  }

  /** Determine the Docker network name for the Kafka containers. */
  determineKafkaDockerNetworks(kafkaContainers: ContainerInspectResponse[]): string[] {
    const kafkaNetworks: string[] = [];
    kafkaContainers.forEach((container) => {
      if (!container.NetworkSettings?.Networks) {
        return;
      }
      for (const networkName of Object.keys(container.NetworkSettings.Networks)) {
        if (kafkaNetworks.includes(networkName)) {
          continue;
        }
        kafkaNetworks.push(networkName);
      }
    });
    return kafkaNetworks;
  }

  /** Determine the bootstrap servers from the Kafka container environment variables. */
  async determineKafkaBootstrapServers(
    kafkaContainers: ContainerInspectResponse[],
  ): Promise<string[]> {
    const bootstrapServers: string[] = [];

    // parse the KAFKA_LISTENERS env vars to get the bootstrap servers
    kafkaContainers.forEach((container: ContainerInspectResponse) => {
      const envVars: Record<string, string> = getContainerEnvVars(container);
      if (!envVars || !envVars.KAFKA_LISTENERS) {
        return;
      }
      // e.g. PLAINTEXT://:9092,CONTROLLER://:9093 and maybe PLAINTEXT_HOST://:9094
      const listeners: string[] = envVars.KAFKA_LISTENERS.split(",");
      for (const listener of listeners) {
        if (!listener.startsWith("PLAINTEXT://")) {
          continue;
        }
        const bootstrapServer = listener.split("//")[1];
        bootstrapServers.push(bootstrapServer);
      }
    });

    return bootstrapServers;
  }

  async createSchemaRegistryContainer(
    kafkaBootstrapServers: string[],
    kafkaNetworks: string[],
  ): Promise<LocalResourceContainer> {
    this.logAndUpdateProgress(`Creating ${this.resourceKind} container "${CONTAINER_NAME}"...`);

    const restProxyPort: number = await findFreePort();
    const hostConfig: HostConfig = {
      NetworkMode: kafkaNetworks[0],
      PortBindings: {
        [`${restProxyPort}/tcp`]: [{ HostIp: "0.0.0.0", HostPort: restProxyPort.toString() }],
      },
    };
    const envVars: string[] = [
      `SCHEMA_REGISTRY_KAFKASTORE_BOOTSTRAP_SERVERS=PLAINTEXT://${kafkaBootstrapServers.join(",")}`,
      `SCHEMA_REGISTRY_HOST_NAME=${CONTAINER_NAME}`,
      `SCHEMA_REGISTRY_LISTENERS=http://0.0.0.0:${restProxyPort}`,
      "SCHEMA_REGISTRY_DEBUG=true",
    ];
    const body: ContainerCreateRequest = {
      Image: `${ConfluentPlatformSchemaRegistryWorkflow.imageRepo}:${this.imageTag}`,
      Hostname: CONTAINER_NAME,
      ExposedPorts: {
        [`${restProxyPort}/tcp`]: {},
      },
      HostConfig: hostConfig,
      Env: envVars,
      Tty: false,
    };

    const container: ContainerCreateResponse = await createContainer(
      ConfluentPlatformSchemaRegistryWorkflow.imageRepo,
      this.imageTag,
      {
        body,
        name: CONTAINER_NAME,
      },
    );

    // inform the sidecar that it needs to look for the Schema Registry container at the dynamically
    // assigned REST proxy port
    await updateLocalSchemaRegistryURI(`http://localhost:${restProxyPort}`);

    return { id: container.Id, name: CONTAINER_NAME };
  }

  private async stopSchemaRegistryContainer(container: LocalResourceContainer): Promise<void> {
    // names may start with a leading slash, so try to remove it
    const containerName = container.name.replace(/^\/+/, "");
    // check container status before deleting
    const existingContainer: ContainerInspectResponse | undefined = await getContainer(
      container.id,
    );
    if (!existingContainer) {
      // assume it was cleaned up some other way
      this.logger.warn("Container not found, skipping stop and delete steps.", {
        id: container.id,
        name: containerName,
      });
      return;
    }

    if (existingContainer.State?.Status === "running") {
      await stopContainer(container.id);
      this.sendTelemetryEvent("Docker Container Stopped", {
        dockerContainerName: containerName,
      });
    }
  }
}
