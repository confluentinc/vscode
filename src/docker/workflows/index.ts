import net from "net";
import { CancellationToken, Progress } from "vscode";
import { Logger } from "../../logging";
import { imageExists, pullImage } from "../images";

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

  /** Docker image to use for this workflow. */
  static imageRepo: string;
  /** Tag for the Docker image to use for this workflow. */
  protected imageTag: string = "latest";

  /** Start the workflow to launch the local resource(s). */
  abstract start(
    token: CancellationToken,
    progress?: Progress<{ message?: string; increment?: number }>,
  ): Promise<void>;

  /** Stop and remove the local resource(s) associated with this workflow. */
  abstract stop(
    token: CancellationToken,
    progress?: Progress<{ message?: string; increment?: number }>,
  ): Promise<void>;

  /** Check if the this workflow's base image repo:tag exists locally, pulling it if not. */
  protected async checkForImage(): Promise<void> {
    // get the repo from the child instances' static property
    const imageRepo = (this.constructor as typeof LocalResourceWorkflow).imageRepo;

    const checkImageMsg = `Checking for "${imageRepo}:${this.imageTag}"...`;
    this.logger.debug(checkImageMsg);
    this.progress?.report({ message: checkImageMsg });

    const existingImage = await imageExists(imageRepo, this.imageTag);
    this.logger.debug(`Image exists: ${existingImage}`, {
      imageRepo,
      imageTag: this.imageTag,
    });
    if (!existingImage) {
      const pullImageMsg = `Pulling "${imageRepo}:${this.imageTag}"...`;
      this.logger.debug(pullImageMsg);
      this.progress?.report({ message: pullImageMsg });
      await pullImage(imageRepo, this.imageTag);
    }
  }
}

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
