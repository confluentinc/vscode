import { workspace, WorkspaceConfiguration } from "vscode";
import { ImageApi, ImageInspect, ResponseError } from "../clients/docker";
import { Logger } from "../logging";
import { LOCAL_KAFKA_IMAGE, LOCAL_KAFKA_IMAGE_TAG } from "../preferences/constants";
import { defaultRequestInit } from "./configs";
import { DEFAULT_KAFKA_IMAGE_REPO, DEFAULT_KAFKA_IMAGE_TAG } from "./constants";
import { streamToString } from "./stream";

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
    logger.debug(`Checking "${repoTag}" in response repoTags...`, {
      responseRepoTags: response.RepoTags,
    });
    return `${response.RepoTags}`.includes(repoTag);
  } catch (error) {
    if (error instanceof ResponseError) {
      const body = await streamToString(error.response.clone().body);
      if (error.response.status === 404) {
        logger.debug(`Image not found: ${repoTag}`);
        return false;
      } else {
        logger.error("Error response inspecting image:", {
          status: error.response.status,
          statusText: error.response.statusText,
          body: body,
        });
      }
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
    try {
      await waitForImageToExist(repo, tag);
      logger.debug("Image pulled successfully", { repo, tag });
    } catch (error) {
      logger.error("Error waiting for image to exist:", error);
    }
  } catch (error) {
    if (error instanceof ResponseError) {
      const body = await streamToString(error.response.clone().body);
      logger.error("Error response pulling image:", {
        status: error.response.status,
        statusText: error.response.statusText,
        body: body,
      });
    } else {
      logger.error("Error pulling image:", error);
    }
  }
}

async function waitForImageToExist(repo: string, tag: string, maxWaitTimeSec: number = 60) {
  const start = Date.now();
  while (Date.now() - start < maxWaitTimeSec * 1000) {
    if (await imageExists(repo, tag)) {
      const duration = Date.now() - start;
      logger.debug(`Image ${repo}:${tag} found after ${duration}ms`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Image ${repo}:${tag} not found after ${maxWaitTimeSec} seconds`);
}
