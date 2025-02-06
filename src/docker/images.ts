import { ImageApi, ImageSummary, ResponseError } from "../clients/docker";
import { Logger } from "../logging";
import { UserEvent, logUsage } from "../telemetry/events";
import { defaultRequestInit } from "./configs";

const logger = new Logger("docker.images");

/** Check if an image exists in the local registry. */
export async function imageExists(repo: string, tag: string): Promise<boolean> {
  const repoTag = `${repo}:${tag}`;

  const client = new ImageApi();
  const init: RequestInit = await defaultRequestInit();

  try {
    const response: ImageSummary[] = await client.imageList({}, init);
    const matchingImage = response.find((imageSummary) => imageSummary.RepoTags.includes(repoTag));
    logger.debug(`"${repoTag}" image exists:`, !!matchingImage);
    return !!matchingImage;
  } catch (error) {
    if (error instanceof ResponseError) {
      logger.error("Error response listing images:", {
        status: error.response.status,
        statusText: error.response.statusText,
        body: await error.response.clone().text(),
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
  const init: RequestInit = await defaultRequestInit();

  try {
    // use the `imageCreateRaw` method to get the raw response text, because otherwise we get a void response
    const resp = await client.imageCreateRaw({ fromImage: repoTag }, init);
    // wait for all the "Pulling..."/"Already exists" type messages to be finished
    await resp.raw.clone().text();
    logger.debug(`Pulled "${repoTag}" image:`, {
      status: resp.raw.status,
      statusText: resp.raw.statusText,
    });
    logUsage(UserEvent.LocalDockerAction, {
      status: "image pulled",
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
