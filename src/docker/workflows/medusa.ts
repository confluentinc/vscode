import { CancellationToken, Progress } from "vscode";
import {
  ContainerCreateRequest,
  ContainerCreateResponse,
  ContainerInspectResponse,
  ContainerStateStatusEnum,
  ContainerSummary,
  HostConfig,
} from "../../clients/docker";
import { LOCAL_MEDUSA_INTERNAL_PORT } from "../../constants";
import { LOCAL_MEDUSA_IMAGE, LOCAL_MEDUSA_IMAGE_TAG } from "../../extensionSettings/constants";
import { Logger } from "../../logging";
import { showErrorNotificationWithButtons } from "../../notifications";
import { getLocalResourceContainers } from "../../sidecar/connections/local";
import { UserEvent } from "../../telemetry/events";
import { createContainer } from "../containers";
import { createNetwork } from "../networks";
import { findFreePort } from "../ports";
import { LocalResourceContainer, LocalResourceWorkflow } from "./base";

export const CONTAINER_NAME = "vscode-medusa";

export class MedusaWorkflow extends LocalResourceWorkflow {
  resourceKind: string = "Medusa";
  static imageRepo = "us-east1-docker.pkg.dev/medusa-prod-env/medusa/medusa";

  logger = new Logger("docker.workflow.medusa");

  // ensure only one instance of this workflow can run at a time
  private static instance: MedusaWorkflow;
  private constructor() {
    super(); // must call super() in derived class constructor
  }
  static getInstance(): MedusaWorkflow {
    if (!MedusaWorkflow.instance) {
      MedusaWorkflow.instance = new MedusaWorkflow();
    }
    return MedusaWorkflow.instance;
  }

  /**
   * Start Medusa container locally:
   * - Ensure the Docker image is available
   * - Check for existing containers and exit early if found
   * - Create a network if it doesn't exist
   * - Create the Medusa container
   * - Start the container
   * - Wait for the container to be ready
   */
  async start(
    token: CancellationToken,
    progress?: Progress<{ message?: string; increment?: number }>,
  ): Promise<void> {
    this.progress = progress;
    this.imageTag = LOCAL_MEDUSA_IMAGE_TAG.value;

    // already handles logging + updating the progress notification
    await this.checkForImage(this.imageRepo, this.imageTag);
    if (token.isCancellationRequested) return;

    const existingContainers: ContainerSummary[] = await getLocalResourceContainers(
      this.imageRepo,
      this.imageTag,
      { onlyExtensionManaged: true, statuses: [] },
    );
    if (existingContainers.length > 0) {
      // this will handle logging and notifications
      await this.handleExistingContainers(existingContainers);
      return;
    }

    this.logAndUpdateProgress(`Creating "${this.networkName}" network...`);
    await createNetwork(this.networkName);
    if (token.isCancellationRequested) return;

    // create the Medusa container
    const container: LocalResourceContainer | undefined = await this.createMedusaContainer();
    if (!container) {
      showErrorNotificationWithButtons(`Failed to create ${this.resourceKind} container.`);
      return;
    }
    this.sendTelemetryEvent(UserEvent.LocalDockerAction, {
      status: "container created",
      dockerContainerName: container.name,
    });
    if (token.isCancellationRequested) return;

    // start the Medusa container
    this.logAndUpdateProgress(`Starting container "${container.name}"...`);
    const startedContainer: ContainerInspectResponse | undefined =
      await this.startContainer(container);
    if (!startedContainer || token.isCancellationRequested) return;

    this.logAndUpdateProgress(`Waiting for ${this.resourceKind} container to be ready...`);
    await this.waitForLocalResourceEventChange();
  }

  /** Stop Medusa container. */
  async stop(
    token: CancellationToken,
    progress?: Progress<{ message?: string; increment?: number }>,
  ): Promise<void> {
    this.progress = progress;
    this.imageTag = LOCAL_MEDUSA_IMAGE_TAG.value;

    this.logAndUpdateProgress(`Checking existing ${this.resourceKind} containers...`);
    const existingContainers: ContainerSummary[] = await getLocalResourceContainers(
      this.imageRepo,
      this.imageTag,
      { onlyExtensionManaged: false, statuses: [ContainerStateStatusEnum.Running] },
    );

    if (existingContainers.length === 0) {
      this.logAndUpdateProgress(`No ${this.resourceKind} containers found to stop.`);
      return;
    }

    this.logAndUpdateProgress(`Stopping ${this.resourceKind} container...`);
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

    if (token.isCancellationRequested) return;

    this.logAndUpdateProgress(`${this.resourceKind} container stopped successfully.`);
    await this.waitForLocalResourceEventChange();
  }

  /** Create a Medusa container with default configuration. */
  async createMedusaContainer(): Promise<LocalResourceContainer | undefined> {
    this.logAndUpdateProgress(`Creating ${this.resourceKind} container "${CONTAINER_NAME}"...`);

    const hostPort: number = await findFreePort();
    const containerPort = LOCAL_MEDUSA_INTERNAL_PORT; // Medusa runs on port 8082 inside the container

    const hostConfig: HostConfig = {
      NetworkMode: this.networkName,
      PortBindings: {
        [`${containerPort}/tcp`]: [{ HostIp: "0.0.0.0", HostPort: hostPort.toString() }],
      },
    };

    const body: ContainerCreateRequest = {
      Image: `${MedusaWorkflow.imageRepo}:${this.imageTag}`,
      Hostname: CONTAINER_NAME,
      ExposedPorts: {
        [`${containerPort}/tcp`]: {},
      },
      HostConfig: hostConfig,
      Env: [
        // Add any required environment variables for Medusa here
        // Note: Medusa runs on port 8082 internally, mapped to hostPort externally
      ],
      Tty: false,
    };

    let container: ContainerCreateResponse | undefined;
    try {
      container = await createContainer(MedusaWorkflow.imageRepo, this.imageTag, {
        body,
        name: CONTAINER_NAME,
      });
    } catch (error) {
      this.logger.error("Failed to create Medusa container:", error);
      return;
    }

    return container ? { id: container.Id, name: CONTAINER_NAME } : undefined;
  }

  get imageRepo(): string {
    return LOCAL_MEDUSA_IMAGE.value;
  }

  get imageRepoTag(): string {
    return `${this.imageRepo}:${this.imageTag}`;
  }

  async waitForLocalResourceEventChange(): Promise<void> {
    // For now, just complete immediately
    // In a real implementation, you might want to wait for specific events
    // or health checks for the Medusa service
    this.logAndUpdateProgress(`${this.resourceKind} is ready.`);
  }
}
