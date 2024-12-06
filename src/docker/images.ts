import { ImageApi, ImageInspect, ResponseError } from "../clients/docker";
import { Logger } from "../logging";
import { UserEvent, logUsage } from "../telemetry/events";
import { defaultRequestInit } from "./configs";

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
      if (error.response.status === 404) {
        // image not found, callers will probably need to pull it after this returns
        return false;
      } else {
        logger.error("Error response inspecting image:", {
          status: error.response.status,
          statusText: error.response.statusText,
          body: await error.response.clone().text(),
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
    // use the `imageCreateRaw` method to get the raw response text, because otherwise we get a void response
    const resp = await client.imageCreateRaw({ fromImage: repoTag }, init);
    // wait for all the "Pulling..."/"Already exists" type messages to be finished
    await resp.raw.clone().text();
    logger.debug(`Pulled "${repoTag}" image:`, {
      status: resp.raw.status,
      statusText: resp.raw.statusText,
    });
    logUsage(UserEvent.DockerImagePulled, {
      dockerImage: repoTag,
    });
  } catch (error) {
    if (error instanceof ResponseError) {
      logger.error("Error response pulling image:", {
        status: error.response.status,
        statusText: error.response.statusText,
        body: await error.response.clone().text(),
      });
    } else {
      logger.error("Error pulling image:", error);
    }
    throw error;
  }
}
