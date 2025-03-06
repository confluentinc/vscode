import { CancellationToken, commands, Progress, window } from "vscode";
import {
  ContainerCreateRequest,
  ContainerCreateResponse,
  ContainerInspectResponse,
  ContainerListRequest,
  ContainerSummary,
  HostConfig,
} from "../../clients/docker";
import { localSchemaRegistryConnected } from "../../emitters";
import { showErrorNotificationWithButtons } from "../../errors";
import { Logger } from "../../logging";
import { LOCAL_KAFKA_IMAGE, LOCAL_KAFKA_IMAGE_TAG } from "../../preferences/constants";
import { updateLocalConnection } from "../../sidecar/connections/local";
import { UserEvent } from "../../telemetry/events";
import {
  getLocalKafkaImageName,
  getLocalKafkaImageTag,
  getLocalSchemaRegistryImageTag,
} from "../configs";
import { LocalResourceKind, MANAGED_CONTAINER_LABEL } from "../constants";
import {
  createContainer,
  getContainer,
  getContainerEnvVars,
  getContainerPorts,
  getContainersForImage,
} from "../containers";
import { findFreePort } from "../ports";
import { LocalResourceContainer, LocalResourceWorkflow } from "./base";

export const CONTAINER_NAME = "vscode-confluent-schema-registry";

export const START_KAFKA_BUTTON = "Start Kafka";
export const IMAGE_SETTINGS_BUTTON = "Configure Image Settings";

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
      const kafkaWorkflow = LocalResourceWorkflow.getKafkaWorkflow();
      this.logger.error("no Kafka containers found, skipping creation");
      window
        .showErrorMessage(
          `No running Kafka containers found for image "${kafkaWorkflow?.imageRepoTag}". Please start Kafka and try again.`,
          START_KAFKA_BUTTON,
          IMAGE_SETTINGS_BUTTON,
        )
        .then((selection) => {
          if (selection === START_KAFKA_BUTTON) {
            commands.executeCommand("confluent.docker.startLocalResources", [
              LocalResourceKind.Kafka,
            ]);
            this.sendTelemetryEvent(UserEvent.NotificationButtonClicked, {
              buttonLabel: START_KAFKA_BUTTON,
              notificationType: "error",
              purpose: "No Kafka Containers Found",
            });
          } else if (selection === IMAGE_SETTINGS_BUTTON) {
            commands.executeCommand(
              "workbench.action.openSettings",
              `@id:${LOCAL_KAFKA_IMAGE} @id:${LOCAL_KAFKA_IMAGE_TAG}`,
            );
            this.sendTelemetryEvent(UserEvent.NotificationButtonClicked, {
              buttonLabel: IMAGE_SETTINGS_BUTTON,
              notificationType: "error",
              purpose: "No Kafka Containers Found",
            });
          }
        });
      return;
    }
    // inspect the containers to get the Docker network name and boostrap server host+port combos
    const kafkaNetworks: string[] = determineKafkaDockerNetworks(kafkaContainers);
    const kafkaBootstrapServers = await determineKafkaBootstrapServers(kafkaContainers);
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
      showErrorNotificationWithButtons(`Failed to create ${this.resourceKind} container.`);
      return;
    }
    this.sendTelemetryEvent(UserEvent.LocalDockerAction, {
      status: "container created",
      dockerContainerName: container.name,
    });
    if (token.isCancellationRequested) return;

    // start the SR container
    this.logAndUpdateProgress(`Starting container "${container.name}"...`);
    const startedContainer: ContainerInspectResponse | undefined =
      await this.startContainer(container);
    if (!startedContainer || token.isCancellationRequested) return;

    this.logAndUpdateProgress(`Waiting for ${this.resourceKind} container to be ready...`);
    await this.waitForLocalResourceEventChange();
  }

  /** Stop Schema Registry container. */
  async stop(
    token: CancellationToken,
    progress?: Progress<{ message?: string; increment?: number }>,
  ): Promise<void> {
    this.progress = progress;
    this.imageTag = getLocalSchemaRegistryImageTag();

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
    const count = existingContainers.length;
    const plural = count > 1 ? "s" : "";
    if (count === 0) {
      return;
    }

    this.logAndUpdateProgress(`Stopping ${count} ${this.resourceKind} container${plural}...`);
    const promises: Promise<void>[] = [];
    for (const container of existingContainers) {
      if (!container.Id || !container.Names) {
        this.logger.error("Container missing ID or name", {
          id: container.Id,
          names: container.Names,
        });
        continue;
      }
      promises.push(this.stopContainer({ id: container.Id, name: container.Names[0] }));
    }
    await Promise.all(promises);

    // only allow exiting from here since awaiting each stopContainer() call and allowing cancellation
    // there would introduce a delay
    if (token.isCancellationRequested) return;

    this.logAndUpdateProgress(
      `Waiting for ${count} ${this.resourceKind} container${plural} to stop...`,
    );
    await this.waitForLocalResourceEventChange();
  }

  /** Block until we see the {@link localSchemaRegistryConnected} event fire. (Controlled by the
   * EventListener in `src/docker/eventListener.ts` whenever a supported container starts or dies.) */
  async waitForLocalResourceEventChange(): Promise<void> {
    await new Promise((resolve) => {
      const listener = localSchemaRegistryConnected.event(() => {
        listener.dispose();
        resolve(void 0);
      });
    });
  }

  /** List existing Kafka broker containers by user-configurable image repo+tag, then
   * return the container-inspect responses. */
  async fetchAndFilterKafkaContainers(): Promise<ContainerInspectResponse[]> {
    const kafkaWorkflow: LocalResourceWorkflow | undefined =
      LocalResourceWorkflow.getKafkaWorkflow();
    if (!kafkaWorkflow) {
      this.logger.error("Unable to look up Kafka image from workflow.");
      return [];
    }

    const kafkaImageRepo: string = getLocalKafkaImageName();
    const kafkaImageTag: string = getLocalKafkaImageTag();

    // TODO(shoup): update this for direct connections
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
    this.logger.debug(`found ${leaderContainers.length} Kafka "leader" container(s)`);

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
      this.logger.debug(
        `found ${summaries.length} Kafka container(s) associated with leader container`,
      );
      containerSummaries.push(...summaries);
    }

    // either there was no leader container or we couldn't find any other containers, but if there
    // was a leader, we should have at least one container here
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

  async createSchemaRegistryContainer(
    kafkaBootstrapServers: string[],
    kafkaNetworks: string[],
  ): Promise<LocalResourceContainer | undefined> {
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

    let container: ContainerCreateResponse | undefined;
    try {
      container = await createContainer(
        ConfluentPlatformSchemaRegistryWorkflow.imageRepo,
        this.imageTag,
        {
          body,
          name: CONTAINER_NAME,
        },
      );
    } catch (error) {
      this.logger.error("Failed to create container:", { error });
      return;
    }

    // inform the sidecar that it needs to look for the Schema Registry container at the dynamically
    // assigned REST proxy port
    await updateLocalConnection(`http://localhost:${restProxyPort}`);

    return { id: container.Id, name: CONTAINER_NAME };
  }
}

/** Determine the Docker network name for the Kafka containers. */
export function determineKafkaDockerNetworks(
  kafkaContainers: ContainerInspectResponse[],
): string[] {
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
export function determineKafkaBootstrapServers(
  kafkaContainers: ContainerInspectResponse[],
): string[] {
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
