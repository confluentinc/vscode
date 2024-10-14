import { workspace, WorkspaceConfiguration } from "vscode";
import { ImageApi, ImageInspect, ResponseError } from "../clients/docker";
import { Logger } from "../logging";
import { LOCAL_KAFKA_IMAGE, LOCAL_KAFKA_IMAGE_TAG } from "../preferences/constants";
import { defaultRequestInit } from "./configs";
import { DEFAULT_KAFKA_IMAGE_REPO, DEFAULT_KAFKA_IMAGE_TAG } from "./constants";

const logger = new Logger("docker.images");

/** Get the local Kafka image name based on user settings. */
export function getLocalKafkaImageName(): string {
  const configs: WorkspaceConfiguration = workspace.getConfiguration();
  return configs.get(LOCAL_KAFKA_IMAGE, DEFAULT_KAFKA_IMAGE_REPO);
}

/** Get the local Kafka image tag based on user settings. */
export function getLocalKafkaImageTag(): string {
  const configs: WorkspaceConfiguration = workspace.getConfiguration();
  return configs.get(LOCAL_KAFKA_IMAGE_TAG, DEFAULT_KAFKA_IMAGE_TAG);
}

/** Check if an image exists in the local registry. */
export async function imageExists(repo: string, tag: string): Promise<boolean> {
  const repoTag = `${repo}:${tag}`;

  const client = new ImageApi();
  const init: RequestInit = defaultRequestInit();

  try {
    const response: ImageInspect = await client.imageInspect({ name: repo }, init);
    logger.debug(`Checking ${repoTag} in response repoTags...`, { repoTags: response.RepoTags });
    return `${response.RepoTags}`.includes(repoTag);
  } catch (error) {
    if (error instanceof ResponseError) {
      logger.info("Error response pulling image:", {
        status: error.response.status,
        statusText: error.response.statusText,
        body: error.response.body,
      });
    } else {
      logger.error("Error inspecting image:", error);
    }
  }
  return false;
}

/** Pull an image from a registry. */
export async function pullImage(repo: string, tag: string): Promise<void> {
  const repoTag = `${repo}:${tag}`;

  const client = new ImageApi();
  const init: RequestInit = defaultRequestInit();

  try {
    await client.imageCreate({ fromImage: repoTag }, init);
  } catch (error) {
    if (error instanceof ResponseError) {
      logger.error("Error response pulling image:", {
        status: error.response.status,
        statusText: error.response.statusText,
        body: error.response.body,
      });
    } else {
      logger.error("Error pulling image:", error);
    }
  }
}
