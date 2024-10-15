import { CancellationToken, Disposable, Progress, ProgressLocation, window } from "vscode";
import { registerCommandWithLogging } from ".";
import { ContainerCreateResponse } from "../clients/docker";
import { isDockerAvailable } from "../docker/configs";
import { ContainerExistsError, createContainer, startContainer } from "../docker/containers";
import {
  getLocalKafkaImageName,
  getLocalKafkaImageTag,
  imageExists,
  pullImage,
} from "../docker/images";
import { createNetwork } from "../docker/networks";
import { localKafkaConnected } from "../emitters";
import { Logger } from "../logging";

const logger = new Logger("commands.docker");

type NotificationProgress = Progress<{
  message?: string;
  increment?: number;
}>;

async function launchLocalKafka() {
  const dockerAvailable = await isDockerAvailable();
  if (!dockerAvailable) {
    window.showErrorMessage("Unable to launch local Kafka because Docker is not available.");
    return;
  }

  const imageRepo: string = getLocalKafkaImageName();
  const imageTag: string = getLocalKafkaImageTag();
  window.withProgress(
    {
      location: ProgressLocation.Notification,
      title: "Local Kafka",
    },
    async (progress: NotificationProgress, token: CancellationToken) => {
      await launchLocalKafkaWithProgress(progress, token, imageRepo, imageTag);
    },
  );
}

async function launchLocalKafkaWithProgress(
  progress: NotificationProgress,
  token: CancellationToken,
  imageRepo: string,
  imageTag: string,
): Promise<void> {
  if (token.isCancellationRequested) {
    // TODO: cleanup created container?
    return;
  }

  // check for image first and pull if necessary
  const checkImageMsg = `Checking for "${imageRepo}:${imageTag}"...`;
  logger.debug(checkImageMsg);
  progress.report({ message: checkImageMsg });
  const existingImage = await imageExists(imageRepo, imageTag);
  logger.debug(`Image exists: ${existingImage}`, { imageRepo, imageTag });
  if (!existingImage) {
    const pullImageMsg = `Pulling "${imageRepo}:${imageTag}"...`;
    logger.debug(pullImageMsg);
    progress.report({ message: pullImageMsg });
    await pullImage(imageRepo, imageTag);
  }

  // create the network if it doesn't exist
  await createNetwork("confluent-local-network");

  const createContainerMsg = "Creating container...";
  logger.debug(createContainerMsg);
  progress.report({ message: createContainerMsg });
  let containerId: string;
  try {
    const container: ContainerCreateResponse | undefined = await createContainer(
      imageRepo,
      imageTag,
    );
    if (!container) {
      window.showErrorMessage("Failed to create local Kafka container.");
      return;
    }
    containerId = container.Id;
  } catch (error) {
    if (error instanceof ContainerExistsError) {
      // TODO: handle when container needs to be stopped first
    } else {
      logger.error("Error creating container:", error);
    }
    return;
  }

  const startContainerMsg = "Starting container...";
  logger.debug(startContainerMsg);
  progress.report({ message: startContainerMsg });
  await startContainer(containerId);

  // block until the `localKafkaConnected` emitter fires
  await new Promise((resolve) => {
    localKafkaConnected.event(() => {
      resolve(void 0);
    });
  });
}

export function registerDockerCommands(): Disposable[] {
  return [registerCommandWithLogging("confluent.docker.launchLocalKafka", launchLocalKafka)];
}
