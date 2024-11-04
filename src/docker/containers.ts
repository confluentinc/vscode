import {
  ContainerApi,
  ContainerCreateOperationRequest,
  ContainerCreateResponse,
  ContainerInspectResponse,
  ContainerListRequest,
  ContainerSummary,
  ResponseError,
} from "../clients/docker";
import { Logger } from "../logging";
import { defaultRequestInit } from "./configs";
import { MANAGED_CONTAINER_LABEL } from "./constants";
import { imageExists, pullImage } from "./images";

const logger = new Logger("docker.containers");

export async function getContainersForImage(
  request: ContainerListRequest,
): Promise<ContainerSummary[]> {
  const client = new ContainerApi();
  const init: RequestInit = defaultRequestInit();
  try {
    const response: ContainerSummary[] = await client.containerList(request, init);
    const containerIdsAndNames = response.map((container) => ({
      id: container.Id,
      name: container.Names,
    }));
    logger.debug("Containers listed successfully:", JSON.stringify(containerIdsAndNames));
    return response;
  } catch (error) {
    if (error instanceof ResponseError) {
      logger.error("Error response listing containers:", {
        status: error.response.status,
        statusText: error.response.statusText,
        body: await error.response.clone().json(),
      });
    } else {
      logger.error("Error listing containers:", error);
    }
    throw error;
  }
}

export async function createContainer(
  imageRepo: string,
  imageTag: string,
  request: ContainerCreateOperationRequest,
): Promise<ContainerCreateResponse> {
  if (!(await imageExists(imageRepo, imageTag))) {
    await pullImage(imageRepo, imageTag);
  }
  logger.debug("Creating container from image", { imageRepo, imageTag });

  // always add our label to the container for easier identification later
  if (!request.body.Labels) request.body.Labels = {};
  request.body.Labels[MANAGED_CONTAINER_LABEL] = "true";

  const client = new ContainerApi();
  const init: RequestInit = defaultRequestInit();
  try {
    const response: ContainerCreateResponse = await client.containerCreate(request, init);
    logger.info("Container created successfully:", response);
    return response;
  } catch (error) {
    if (error instanceof ResponseError) {
      logger.error("Container creation returned error response:", {
        status: error.response.status,
        statusText: error.response.statusText,
        body: await error.response.clone().json(),
      });
    } else {
      logger.error("Error creating container:", error);
    }
    throw error;
  }
}

export async function startContainer(containerId: string): Promise<void> {
  const client = new ContainerApi();
  const init: RequestInit = defaultRequestInit();

  try {
    await client.containerStart({ id: containerId }, init);
  } catch (error) {
    if (error instanceof ResponseError) {
      logger.error("Error response starting container:", {
        status: error.response.status,
        statusText: error.response.statusText,
        body: await error.response.clone().text(),
      });
    } else {
      logger.error("Error starting container:", error);
    }
    throw error;
  }
}

export async function stopContainer(id: string): Promise<void> {
  const client = new ContainerApi();
  const init: RequestInit = defaultRequestInit();

  try {
    logger.debug("Stopping container", { id });
    await client.containerStop({ id }, init);
  } catch (error) {
    if (error instanceof ResponseError) {
      logger.error("Error response stopping container:", {
        status: error.response.status,
        statusText: error.response.statusText,
        body: await error.response.clone().json(),
      });
    } else {
      logger.error("Error stopping container:", error);
    }
    throw error;
  }
}

export async function restartContainer(id: string) {
  await stopContainer(id);
  await startContainer(id);
}

export async function getContainer(id: string): Promise<ContainerInspectResponse> {
  const client = new ContainerApi();
  const init: RequestInit = defaultRequestInit();

  try {
    return await client.containerInspect({ id }, init);
  } catch (error) {
    if (error instanceof ResponseError) {
      logger.error("Error response inspecting container:", {
        status: error.response.status,
        statusText: error.response.statusText,
        body: await error.response.clone().text(),
      });
    } else {
      logger.error("Error inspecting container:", error);
    }
    throw error;
  }
}
