import net from "net";
import { CancellationToken, commands, Progress } from "vscode";
import { Logger } from "../../logging";
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
    ...args: any[]
  ): Promise<void>;

  /** Stop and remove the local resource(s) associated with this workflow. */
  abstract stop(
    token: CancellationToken,
    progress?: Progress<{ message?: string; increment?: number }>,
  ): Promise<void>;

  /**
   * Wait for the local resource(s) to be created/removed based on event emitters.
   *
   * This should be called at the end of the `start` or `stop` methods to ensure the resource(s) are
   * ready to be used, and any existing progress notifications can be resolved.
   */
  abstract waitForLocalResourceEventChange(): Promise<void>;

  /** Check if the this workflow's base image repo:tag exists locally, pulling it if not. */
  protected async checkForImage(imageRepo: string, imageTag: string): Promise<void> {
    const checkImageMsg = `Checking for "${imageRepo}:${imageTag}"...`;
    this.logger.debug(checkImageMsg);
    this.progress?.report({ message: checkImageMsg });

    const existingImage = await imageExists(imageRepo, imageTag);
    this.logger.debug(`Image exists: ${existingImage}`, {
      imageRepo,
      imageTag: imageTag,
    });
    if (!existingImage) {
      const pullImageMsg = `Pulling "${imageRepo}:${imageTag}"...`;
      this.logger.debug(pullImageMsg);
      this.progress?.report({ message: pullImageMsg });
      await pullImage(imageRepo, imageTag);
    }
  }

  // TODO: maybe put this somewhere else for more general use?
  /** Handle the user's selection from the "Open Logs" button on a notification. */
  handleOpenLogsButton(selection: string | undefined) {
    if (selection === "Open Logs") {
      commands.executeCommand("confluent.showOutputChannel");
    }
  }
}

// maybe this can live somewhere else if we need it for more than just container creation:
/** Look for an available port on the host machine and return it. */
export async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, () => {
      const port = (server.address() as net.AddressInfo).port;
      server.close(() => resolve(port));
    });
  });
}
