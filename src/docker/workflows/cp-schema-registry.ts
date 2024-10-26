import { CancellationToken, Progress, window } from "vscode";
import { findFreePort, LocalResourceContainer, LocalResourceWorkflow } from ".";
import {
  ContainerCreateRequest,
  ContainerCreateResponse,
  ContainerInspectResponse,
  ContainerListRequest,
  ContainerSummary,
  HostConfig,
} from "../../clients/docker";
import { Connection, ConnectionsResourceApi } from "../../clients/sidecar";
import { getKafkaWorkflow } from "../../commands/docker";
import { LOCAL_CONNECTION_ID, LOCAL_CONNECTION_SPEC } from "../../constants";
import { localSchemaRegistryConnected } from "../../emitters";
import { Logger } from "../../logging";
import { getSidecar } from "../../sidecar";
import { getLocalKafkaImageName, getLocalSchemaRegistryImageTag } from "../configs";
import { MANAGED_CONTAINER_LABEL } from "../constants";
import {
  createContainer,
  getContainer,
  getContainerEnvVars,
  getContainersForImage,
  startContainer,
  stopContainer,
} from "../containers";

const CONTAINER_NAME = "vscode-confluent-schema-registry";

export class ConfluentPlatformSchemaRegistryWorkflow extends LocalResourceWorkflow {
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
    await this.checkForImage(ConfluentPlatformSchemaRegistryWorkflow.imageRepo, this.imageTag);

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
    if (existingContainers.length > 0) {
      this.logger.warn("Container already exists, skipping creation.", {
        imageRepo: ConfluentPlatformSchemaRegistryWorkflow.imageRepo,
        imageTag: this.imageTag,
      });
      window.showWarningMessage(
        "Existing Schema Registry container(s) found. Please stop and remove them before starting new ones.",
      );
      return;
    }

    const startedContainer: ContainerInspectResponse | undefined =
      await this.startLocalSchemaRegistryContainer();
    if (!startedContainer) {
      return;
    }

    const waitMsg = "Waiting for container to be ready...";
    this.logger.debug(waitMsg);
    this.progress?.report({ message: waitMsg });
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

    const stopMsg = `Stopping ${existingContainers.length} container(s)...`;
    this.logger.debug(stopMsg);
    this.progress?.report({ message: stopMsg });
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

  async startLocalSchemaRegistryContainer(): Promise<ContainerInspectResponse | undefined> {
    // list existing Kafka containers based on the user-configured image repo+tag
    const kafkaWorkflow: LocalResourceWorkflow | undefined = getKafkaWorkflow();
    if (!kafkaWorkflow) {
      this.logger.error("Unable to look up Kafka image from workflow.");
      return;
    }

    const kafkaImageRepo: string = getLocalKafkaImageName();
    const kafkaImageTag: string = kafkaWorkflow.imageTag;
    const kafkaContainerListRequest: ContainerListRequest = {
      all: true,
      filters: JSON.stringify({
        ancestor: [`${kafkaImageRepo}:${kafkaImageTag}`],
        // label: [MANAGED_CONTAINER_LABEL],
      }),
    };
    const kafkaContainers: ContainerSummary[] =
      await getContainersForImage(kafkaContainerListRequest);
    if (kafkaContainers.length === 0) {
      window.showErrorMessage("No Kafka containers found. Please start Kafka and try again.");
      return;
    }

    // inspect the containers to get the Docker network name and boostrap server host+port combos
    const kafkaNetworks: string[] = kafkaContainers
      .map((container): string | undefined => container.HostConfig?.NetworkMode)
      .filter((network) => !!network) as string[];

    const kafkaContainerInspectPromises: Promise<ContainerInspectResponse | undefined>[] =
      kafkaContainers
        .filter((container) => !!container.Id)
        .map((container) => getContainer(container.Id!));
    const kafkaContainerInspectResponses: ContainerInspectResponse[] = (
      await Promise.all(kafkaContainerInspectPromises)
    ).filter((response): response is ContainerInspectResponse => !!response);
    const kafkaBootstrapServers: string[] = [];
    kafkaContainerInspectResponses.forEach((response: ContainerInspectResponse) => {
      const envVars: Record<string, string> = getContainerEnvVars(response);
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
        kafkaBootstrapServers.push(bootstrapServer);
      }
    });

    this.logger.debug("Kafka container(s) found", {
      count: kafkaContainers.length,
      bootstrapServers: kafkaBootstrapServers,
      networks: kafkaNetworks,
    });

    // create the SR container
    const container: LocalResourceContainer | undefined = await this.createSchemaRegistryContainer(
      kafkaBootstrapServers,
      kafkaNetworks,
    );
    if (!container) {
      window.showErrorMessage("Failed to create Schema Registry container.");
      return;
    }

    // start the SR container
    const startContainerMsg = `Starting container "${container.name}"...`;
    this.logger.debug(startContainerMsg);
    this.progress?.report({ message: startContainerMsg });
    await startContainer(container.id);
    const startedContainer: ContainerInspectResponse | undefined = await getContainer(container.id);
    if (!startedContainer) {
      window
        .showErrorMessage(
          `Failed to start Schema Registry container "${CONTAINER_NAME}".`,
          "Open Logs",
        )
        .then(this.handleOpenLogsButton);
      return;
    }
    return startedContainer;
  }

  async createSchemaRegistryContainer(
    kafkaBootstrapServers: string[],
    kafkaNetworks: string[],
  ): Promise<LocalResourceContainer | undefined> {
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

    const container: ContainerCreateResponse | undefined = await createContainer(
      ConfluentPlatformSchemaRegistryWorkflow.imageRepo,
      this.imageTag,
      {
        body,
        name: CONTAINER_NAME,
      },
    );
    if (!container) {
      window.showErrorMessage("Failed to create Schema Registry container.");
      return;
    }

    // inform the sidecar that it needs to look for the Schema Registry container at the dynamically
    // assigned REST proxy port
    const client: ConnectionsResourceApi = (await getSidecar()).getConnectionsResourceApi();
    const resp: Connection = await client.gatewayV1ConnectionsIdPut({
      id: LOCAL_CONNECTION_ID,
      ConnectionSpec: {
        ...LOCAL_CONNECTION_SPEC,
        local_config: {
          schema_registry_uri: `http://localhost:${restProxyPort}`,
        },
      },
    });
    this.logger.debug("Updated local connection with Schema Registry URI:", resp);

    return { id: container.Id, name: CONTAINER_NAME };
  }

  private async stopContainer(container: LocalResourceContainer): Promise<void> {
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
    }
  }
}
