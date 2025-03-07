import { CancellationToken, Progress, ProgressLocation, window } from "vscode";
import { ContainerInspectResponse, ContainerSummary, ResponseError } from "../../clients/docker";
import { showErrorNotificationWithButtons } from "../../errors";
import { Logger } from "../../logging";
import { ConnectionLabel } from "../../models/resource";
import { logUsage, UserEvent } from "../../telemetry/events";
import { getLocalKafkaImageName, getLocalSchemaRegistryImageName } from "../configs";
import { DEFAULT_DOCKER_NETWORK, LocalResourceKind } from "../constants";
import { getContainer, restartContainer, startContainer, stopContainer } from "../containers";
import { imageExists, pullImage } from "../images";

/** Basic container information for a local resource. */
export interface LocalResourceContainer {
  id: string;
  name: string;
}

/**
 * Base class for workflows that launch local Confluent/Kafka related resources with Docker.
 *
 * Each workflow should:
 * - Define a static `imageRepo` property that specifies the Docker image to use.
 * - Implement the `start` and `stop` methods for their associated local resource(s).
 * - Ensure that only one instance of the workflow can run at a time.
 * - Handle logging, cancellation, and progress reporting (if applicable).
 */
export abstract class LocalResourceWorkflow {
  /** Logger for this workflow. */
  protected abstract logger: Logger;
  protected progress?: Progress<{ message?: string; increment?: number }>;

  /** Default Docker network name to use for all workflows' `.start()` logic. */
  networkName: string = DEFAULT_DOCKER_NETWORK;

  /** Basic label for notifications and logs to tell the user what kind of resource is being started
   * or stopped for the given workflow. */
  abstract resourceKind: string;

  /**
   * Docker image to use for this workflow.
   *
   * Should **not** be configurable by the user, only selectable from an array of string enum values
   * set in the `confluent.localDocker.kafkaImageRepo` setting, which should match to one workflow.
   */
  static imageRepo: string;
  /** Tag for the Docker image to use for this workflow. Should be configurable by the user in extension settings. */
  imageTag: string = "latest";

  // Registry to store workflow instances by image repo
  private static workflowRegistry: Map<string, LocalResourceWorkflow> = new Map();

  /** Register a {@link LocalResourceWorkflow} implementation based on its image repo. */
  static registerWorkflow(workflow: LocalResourceWorkflow): void {
    const imageRepo: string = workflow.imageRepo;
    LocalResourceWorkflow.workflowRegistry.set(imageRepo, workflow);
  }

  /** Get the workflow for a specific {@link LocalResourceKind}. */
  static getWorkflowForKind(kind: LocalResourceKind): LocalResourceWorkflow {
    switch (kind) {
      case LocalResourceKind.Kafka:
        return LocalResourceWorkflow.getKafkaWorkflow();
      case LocalResourceKind.SchemaRegistry:
        return LocalResourceWorkflow.getSchemaRegistryWorkflow();
      default:
        throw new Error(`No workflow available for resource kind: ${kind}`);
    }
  }

  /** Get the Kafka workflow based on the user-configured image repo setting. */
  static getKafkaWorkflow(): LocalResourceWorkflow {
    const imageRepo: string = getLocalKafkaImageName();
    const workflow: LocalResourceWorkflow | undefined =
      LocalResourceWorkflow.workflowRegistry.get(imageRepo);
    if (!workflow) {
      const errorMsg = `Unsupported Kafka image repo: ${imageRepo}`;
      window.showErrorMessage(errorMsg);
      throw new Error(errorMsg);
    }
    return workflow;
  }

  /** Get the Schema Registry workflow based on the user-configured image repo setting. */
  public static getSchemaRegistryWorkflow(): LocalResourceWorkflow {
    const imageRepo: string = getLocalSchemaRegistryImageName();
    const workflow: LocalResourceWorkflow | undefined =
      LocalResourceWorkflow.workflowRegistry.get(imageRepo);
    if (!workflow) {
      const errorMsg = `Unsupported Schema Registry image repo: ${imageRepo}`;
      window.showErrorMessage(errorMsg);
      throw new Error(errorMsg);
    }
    return workflow;
  }

  /** Start the workflow to launch the local resource(s). */
  abstract start(
    token: CancellationToken,
    progress?: Progress<{ message?: string; increment?: number }>,
    ...args: any[]
  ): Promise<void>;

  /**
   * Common flow for attempting to start a container by its Start a specific container for a workflow by its provided ID. If any errors occur, a notification
   * will be shown to the user and no {@link ContainerInspectResponse} will be returned. */
  async startContainer(
    container: LocalResourceContainer,
  ): Promise<ContainerInspectResponse | undefined> {
    try {
      await startContainer(container.id);
      this.sendTelemetryEvent(UserEvent.LocalDockerAction, {
        status: "container started",
        dockerContainerName: container.name,
      });
    } catch (error) {
      let errorMsg = error instanceof Error ? error.message : "Unknown error";
      if (error instanceof ResponseError) {
        // likely "... <containername+id>: Bind for 0.0.0.0:8082 failed: port is already allocated"
        try {
          const body = await error.response.clone().json();
          errorMsg = body.message;
          if (body.message.includes("port is already allocated")) {
            const portErrorMatch = body.message.match(
              /Bind for 0\.0\.0\.0:(\d+) failed: port is already allocated/,
            );
            if (portErrorMatch) {
              const port = portErrorMatch[1];
              errorMsg = `Port ${port} is already in use.`;
            }
          } else {
            errorMsg = "Port is already in use.";
          }
        } catch {
          errorMsg = error.response.statusText;
        }
      }
      showErrorNotificationWithButtons(
        `Failed to start ${this.resourceKind} container "${container.name}": ${errorMsg}`,
      );
      return;
    }

    return await getContainer(container.id);
  }

  /** Stop the local resource(s) associated with this workflow. */
  abstract stop(
    token: CancellationToken,
    progress?: Progress<{ message?: string; increment?: number }>,
  ): Promise<void>;

  /** Common flow for attempting to stop a container for a workflow. If the container is not found,
   * a warning will be logged and no action will be taken. */
  async stopContainer(container: LocalResourceContainer): Promise<void> {
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
      this.sendTelemetryEvent(UserEvent.LocalDockerAction, {
        status: "container stopped",
        dockerContainerName: container.name,
      });
    }
  }

  // instance method to allow calling `this.imageRepo` along with the static `<WorkflowName>.imageRepo`
  get imageRepo(): string {
    return (this.constructor as typeof LocalResourceWorkflow).imageRepo;
  }

  /** The colon-separated `imageRepo` and `imageTag` for this workflow. */
  get imageRepoTag(): string {
    return `${this.imageRepo}:${this.imageTag}`;
  }

  /**
   * Wait for the local resource(s) to be created/removed based on event emitters.
   *
   * This should be called at the end of the `start` or `stop` methods to ensure the resource(s) are
   * ready to be used, and any existing progress notifications can be resolved.
   */
  abstract waitForLocalResourceEventChange(): Promise<void>;

  /** Check if the this workflow's base image repo:tag exists locally, pulling it if not. */
  async checkForImage(imageRepo: string, imageTag: string): Promise<void> {
    this.logAndUpdateProgress(`Checking for "${imageRepo}:${imageTag}"...`);

    const existingImage = await imageExists(imageRepo, imageTag);
    this.logger.debug(`Image exists: ${existingImage}`, {
      imageRepo,
      imageTag,
    });
    if (!existingImage) {
      this.logAndUpdateProgress(`Pulling "${imageRepo}:${imageTag}"...`);
      await pullImage(imageRepo, imageTag);
    }
  }

  /**
   * Handle when a workflow detects existing containers based on its image repo+tag by checking the
   * container states and auto-(re)starting them. This acts as a mini-workflow within the main one
   * by showing a progress notification while the containers are started/restarted.
   */
  async handleExistingContainers(containers: ContainerSummary[]) {
    const plural = containers.length > 1 ? "s" : "";
    const containerNames: string[] = containers.map(
      (container) => container.Names?.join(", ") || "unknown",
    );
    const containerImages: string[] = containers.map((container) => container.Image || "unknown");
    const containerStates: string[] = containers.map((container) => container.State || "unknown");
    this.logger.debug(`found ${containers.length} existing container${plural}`, {
      states: containerStates,
      names: containerNames,
      images: containerImages,
    });

    const anyRunning: boolean = containers.some((container) => container.State === "running");
    window.withProgress(
      {
        location: ProgressLocation.Notification,
        title: ConnectionLabel.LOCAL,
        cancellable: true,
      },
      async (progress, token: CancellationToken) => {
        token.onCancellationRequested(() => {
          this.logger.debug("cancellation requested, exiting workflow early");
          this.sendTelemetryEvent(UserEvent.NotificationButtonClicked, {
            buttonLabel: "Cancel",
            notificationType: "progress",
            purpose: `Existing ${this.resourceKind} Containers Detected`,
          });
        });

        this.progress = progress;
        const actionLabel = anyRunning ? "Restarting..." : "Starting...";
        this.logAndUpdateProgress(
          `Found ${containers.length} existing ${this.resourceKind} container${plural}. ${actionLabel}`,
        );

        for (const container of containers) {
          if (!(container.Id && container.Names)) {
            // ID & Names not required by the OpenAPI spec, but very unlikely to be missing if we have the container
            // https://docs.docker.com/reference/api/engine/version/v1.47/#tag/Container/operation/ContainerList
            this.logger.warn("missing container ID or name; can't start/restart container", {
              container,
            });
            continue;
          }
          // if any are in RUNNING state, auto-restart, otherwise auto-start
          if (container.State === "running") {
            await restartContainer(container.Id);
          } else {
            await this.startContainer({ id: container.Id, name: container.Names[0] });
          }
        }

        this.logAndUpdateProgress(
          `Waiting for ${this.resourceKind} container${plural} to be ready...`,
        );
        // resolve and close this progress notification once the workflow gives the all-clear
        await this.waitForLocalResourceEventChange();
      },
    );
  }

  /** Log a message and display it in the user-facing progress notification for this workflow. */
  logAndUpdateProgress(message: string, ...args: any[]) {
    this.logger.debug(message, ...args);
    this.progress?.report({ message: message });
  }

  sendTelemetryEvent(eventName: UserEvent, properties: Record<string, any>) {
    logUsage(eventName, {
      dockerImage: this.imageRepoTag,
      localResourceKind: this.resourceKind,
      ...properties,
    });
  }
}
