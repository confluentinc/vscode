import { ImageApi, ImageInspect, ResponseError } from "../clients/docker";
import { Logger } from "../logging";
import { defaultRequestInit } from "./configs";
import { streamToString } from "./stream";

const logger = new Logger("docker.images");

/** Check if an image exists in the local registry. */
export async function imageExists(repo: string, tag: string): Promise<boolean> {
  const repoTag = `${repo}:${tag}`;

  const client = new ImageApi();
  const init: RequestInit = defaultRequestInit();

  try {
    const response: ImageInspect = await client.imageInspect({ name: repo }, init);
    const repoTagFound = `${response.RepoTags}`.includes(repoTag);
    logger.debug(`Checked "${repoTag}" in available repo+tags:`, {
      repoTagFound,
      repoTag,
      responseRepoTags: response.RepoTags,
    });
    return repoTagFound;
  } catch (error) {
    if (error instanceof ResponseError) {
      const body = await streamToString(error.response.clone().body);
      if (error.response.status === 404) {
        // image not found, callers will probably need to pull it after this returns
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
