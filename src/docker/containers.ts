import {
  ContainerApi,
  ContainerCreateOperationRequest,
  ContainerCreateRequest,
  ResponseError,
} from "../clients/docker";
import { Logger } from "../logging";
import { defaultRequestInit } from "./configs";
import { imageExists, pullImage } from "./images";

const logger = new Logger("docker.containers");

export async function createContainer(imageRepo: string, imageTag: string) {
  // check for image first and pull if necessary
  const existingImage = await imageExists(imageRepo, imageTag);
  if (!existingImage) {
    await pullImage(imageRepo, imageTag);
  }

  // check for container existence
  const repoTag = `${imageRepo}:${imageTag}`;
  const client = new ContainerApi();
  const init: RequestInit = defaultRequestInit();

  // TODO: implement check for existing container

  // create the container before starting
  const body: ContainerCreateRequest = {
    Image: repoTag,
    Tty: true,
  };
  const request: ContainerCreateOperationRequest = { body };

  try {
    const response = await client.containerCreate(request, init);
    logger.info("Container created successfully", response);
  } catch (error) {
    if (error instanceof ResponseError) {
      logger.error("Container creation returned error response:", {
        status: error.response.status,
        statusText: error.response.statusText,
        body: error.response.body,
      });
    } else {
      logger.error("Error creating container:", error);
    }
  }
}

export async function startContainer(imageRepo: string, imageTag: string) {
  // TODO: implement startContainer
}
