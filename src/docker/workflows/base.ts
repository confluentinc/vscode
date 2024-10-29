import { CancellationToken, commands, Progress, window } from "vscode";
import { ContainerInspectResponse, ContainerSummary, ResponseError } from "../../clients/docker";
import { Logger } from "../../logging";
import { getTelemetryLogger } from "../../telemetry/telemetryLogger";
import { getContainer, restartContainer, startContainer } from "../containers";
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
  networkName: string = "vscode-confluent-local-network";

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

  /** Start the workflow to launch the local resource(s). */
  abstract start(
    token: CancellationToken,
    progress?: Progress<{ message?: string; increment?: number }>,
  ): Promise<void>;

  /**
   * Common flow for attempting to start a container by its Start a specific container for a workflow by its provided ID. If any errors occur, a notification
   * will be shown to the user and no {@link ContainerInspectResponse} will be returned. */
  async startContainer(
    container: LocalResourceContainer,
  ): Promise<ContainerInspectResponse | undefined> {
    try {
      await startContainer(container.id);
      this.sendTelemetryEvent("Docker Container Started", {
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
      this.showErrorNotification(
        `Failed to start ${this.resourceKind} container "${container.name}": ${errorMsg}`,
      );
      return;
    }

    return await getContainer(container.id);
  }

  /** Stop and remove the local resource(s) associated with this workflow. */
  abstract stop(
    token: CancellationToken,
    progress?: Progress<{ message?: string; increment?: number }>,
  ): Promise<void>;

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

  // TODO: maybe put this somewhere else for more general use?
  /** Show an error notification for this workflow with buttons to "Open Logs" or "File an Issue". */
  showErrorNotification(message: string) {
    this.logger.error("showing error notification:", message);
    const logsButton = "Open Logs";
    const issueButton = "File an Issue";
    window.showErrorMessage(message, logsButton, issueButton).then(async (selection) => {
      if (!selection) return;

      if (selection === logsButton) {
        commands.executeCommand("confluent.showOutputChannel");
      } else if (selection === issueButton) {
        commands.executeCommand("confluent.support.issue");
      }

      this.sendTelemetryEvent("Notification Button Clicked", {
        buttonLabel: selection,
        notificationType: "error",
      });
    });
  }

  /**
   * Handle when a workflow detects existing containers based on its image repo+tag by checking the
   * container states and prompting the user to take action.
   */
  async handleExistingContainers(containers: ContainerSummary[]) {
    const count = containers.length;
    const plural = containers.length > 1 ? "s" : "";
    const containerNames: string[] = containers.map(
      (container) => container.Names?.join(", ") || "unknown",
    );
    const containerImages: string[] = containers.map((container) => container.Image || "unknown");
    const containerStates: string[] = containers.map((container) => container.State || "unknown");
    this.logger.debug(`found ${count} existing container${plural}`, {
      states: containerStates,
      names: containerNames,
      images: containerImages,
    });
    // if any are in RUNNING state, ask to restart, otherwise ask to start
    let buttonLabel = "";
    const anyRunning = containerStates.includes("running");
    if (anyRunning) {
      buttonLabel = ""; // doesn't actually show a button; TODO(shoup): set in downstream branch
    } else {
      buttonLabel = count > 1 ? "Start All" : "Start";
    }

    window
      .showErrorMessage(
        `Existing ${this.resourceKind} container${plural} found. Please ${anyRunning ? "re" : ""}start or remove ${count > 1 ? "them" : "it"} and try again.`,
        buttonLabel,
      )
      .then(async (choice) => {
        if (choice === buttonLabel) {
          this.sendTelemetryEvent("Notification Button Clicked", {
            anyContainersRunning: anyRunning,
            buttonLabel: choice,
            notificationType: "error",
            numContainers: containers.length,
            purpose: "Existing Containers Found",
          });
          for (const container of containers) {
            if (!(container.Id && container.Names)) {
              // ID & Names not required by the OpenAPI spec, but very unlikely to be missing if we have the container
              // https://docs.docker.com/reference/api/engine/version/v1.47/#tag/Container/operation/ContainerList
              continue;
            }
            if (anyRunning) {
              await restartContainer(container.Id);
            } else {
              await this.startContainer({ id: container.Id, name: container.Names[0] });
            }
          }
        }
      });
    this.sendTelemetryEvent("Notification Shown", {
      notificationType: "error",
      numContainers: containers.length,
      purpose: `Existing ${this.resourceKind} Containers`,
    });
  }

  /** Log a message and display it in the user-facing progress notification for this workflow. */
  logAndUpdateProgress(message: string, ...args: any[]) {
    this.logger.debug(message, ...args);
    this.progress?.report({ message: message });
  }

  sendTelemetryEvent(eventName: string, properties: Record<string, any>) {
    getTelemetryLogger().logUsage(eventName, {
      dockerImage: this.imageRepoTag,
      extensionUserFlow: "Local Resource Management",
      localResourceKind: this.resourceKind,
      localResourceWorkflow: this.constructor.name,
      ...properties,
    });
  }
}
