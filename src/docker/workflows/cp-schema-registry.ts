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
import { getKafkaWorkflow } from "../../commands/docker";
import { localKafkaConnected } from "../../emitters";
import { Logger } from "../../logging";
import { getLocalSchemaRegistryImageTag } from "../configs";
import { MANAGED_CONTAINER_LABEL } from "../constants";
import { createContainer, getContainer, getContainersForImage, stopContainer } from "../containers";

const CONTAINER_NAME_PREFIX = "vscode-confluent-schema-registry";

export class ConfluentPlatformSchemaRegistryWorkflow extends LocalResourceWorkflow {
  static imageRepo = "confluentinc/cp-schema-registry";

  logger = new Logger("docker.workflow.cp-schema-registry");

  networkName: string = "vscode-confluent-local-network";

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

    // list existing Kafka containers based on the user-configured image repo+tag
    const kafkaWorkflow: LocalResourceWorkflow | undefined = getKafkaWorkflow();
    if (!kafkaWorkflow) {
      this.logger.error("Unable to look up Kafka image from workflow.");
      return;
    }

    const kafkaImageRepo: string = kafkaWorkflow.constructor().imageRepo;
    const kafkaImageTag: string = kafkaWorkflow.constructor().imageTag;
    const kafkaContainerListRequest: ContainerListRequest = {
      all: true,
      filters: JSON.stringify({
        ancestor: [`${kafkaImageRepo}:${kafkaImageTag}`],
        label: [MANAGED_CONTAINER_LABEL],
      }),
    };
    const kafkaContainers: ContainerSummary[] =
      await getContainersForImage(kafkaContainerListRequest);
    if (kafkaContainers.length === 0) {
      window.showErrorMessage(
        "No Kafka containers found. Please start Kafka before Schema Registry.",
      );
      return;
    }

    // inspect the containers to get the boostrap server URLs and Docker network name
    const kafkaBootstrapServers: string[] = [];

    // create the SR container
    const createdContainer: ContainerCreateResponse | undefined =
      await this.createSchemaRegistryContainer(kafkaBootstrapServers);
    if (!createdContainer) {
      window.showErrorMessage("Failed to create Schema Registry container.");
      return;
    }
    // start the SR container

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

  /** Block until we see the {@link localKafkaConnected} event fire. (Controlled by the EventListener
   * in `src/docker/eventListener.ts` whenever a supported container starts or dies.) */
  async waitForLocalResourceEventChange(): Promise<void> {
    await new Promise((resolve) => {
      localKafkaConnected.event(() => {
        resolve(void 0);
      });
    });
  }

  async createSchemaRegistryContainer(
    bootstrapServers: string[],
  ): Promise<ContainerCreateResponse | undefined> {
    const restProxyPort: number = await findFreePort();

    const hostConfig: HostConfig = {
      NetworkMode: this.networkName,
      PortBindings: {
        [`${restProxyPort}/tcp`]: [{ HostIp: "0.0.0.0", HostPort: restProxyPort.toString() }],
      },
    };
    const envVars: string[] = [
      `SCHEMA_REGISTRY_KAFKASTORE_BOOTSTRAP_SERVERS=PLAINTEXT://${bootstrapServers.join(",")}`,
      `SCHEMA_REGISTRY_HOST_NAME=${CONTAINER_NAME_PREFIX}`,
      `SCHEMA_REGISTRY_LISTENERS=http://0.0.0.0:${restProxyPort}`,
      "SCHEMA_REGISTRY_DEBUG=true",
    ];
    const body: ContainerCreateRequest = {
      Image: `${ConfluentPlatformSchemaRegistryWorkflow.imageRepo}:${this.imageTag}`,
      Hostname: CONTAINER_NAME_PREFIX,
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
        name: CONTAINER_NAME_PREFIX,
      },
    );
    if (!container) {
      window.showErrorMessage("Failed to create Schema Registry container.");
      return;
    }
    return container;
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
