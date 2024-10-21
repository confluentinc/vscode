import {
  ContainerApi,
  ContainerCreateOperationRequest,
  ContainerCreateResponse,
  ContainerInspectResponse,
  ContainerListRequest,
  ContainerStateStatusEnum,
  ContainerSummary,
  ResponseError,
} from "../clients/docker";
import { Logger } from "../logging";
import { defaultRequestInit } from "./configs";
import { imageExists, pullImage } from "./images";
import { streamToString } from "./stream";

const logger = new Logger("docker.containers");

export async function getContainersForImage(
  imageRepo: string,
  imageTag: string,
  status?: ContainerStateStatusEnum,
): Promise<ContainerSummary[]> {
  // if the tag is "latest", we don't need to specify it
  const repoTag = imageTag === "latest" ? imageRepo : `${imageRepo}:${imageTag}`;

  // if `status` is provided, use that instead of listing all containers
  const filters: Record<string, any> = {
    ancestor: [repoTag],
  };
  if (status) filters["status"] = [status];
  const request: ContainerListRequest = {
    filters: JSON.stringify(filters),
  };
  if (!status) request.all = true;

  const client = new ContainerApi();
  const init: RequestInit = defaultRequestInit();
  try {
    const response: ContainerSummary[] = await client.containerList(request, init);
    logger.debug("Containers listed successfully", JSON.stringify(response));
    return response;
  } catch (error) {
    if (error instanceof ResponseError) {
      const body = await streamToString(error.response.clone().body);
      logger.error("Error response listing containers:", {
        status: error.response.status,
        statusText: error.response.statusText,
        body: body,
      });
    } else {
      logger.error("Error listing containers:", error);
    }
  }
  return [];
}

export async function createContainer(
  imageRepo: string,
  imageTag: string,
  request: ContainerCreateOperationRequest,
): Promise<ContainerCreateResponse | undefined> {
  if (!(await imageExists(imageRepo, imageTag))) {
    await pullImage(imageRepo, imageTag);
  }
  logger.debug("Creating container from image", { imageRepo, imageTag });

  const client = new ContainerApi();
  const init: RequestInit = defaultRequestInit();
  try {
    const response: ContainerCreateResponse = await client.containerCreate(request, init);
    logger.info("Container created successfully", response);
    return response;
  } catch (error) {
    if (error instanceof ResponseError) {
      const body = await streamToString(error.response.clone().body);

      // TODO: if port is occupied, throw a more specific error

      logger.error("Container creation returned error response:", {
        status: error.response.status,
        statusText: error.response.statusText,
        body: body,
      });
    } else {
      logger.error("Error creating container:", error);
    }
  }
}

export async function startContainer(containerId: string) {
  const client = new ContainerApi();
  const init: RequestInit = defaultRequestInit();

  try {
    await client.containerStart({ id: containerId }, init);
  } catch (error) {
    if (error instanceof ResponseError) {
      const body = await streamToString(error.response.clone().body);
      logger.error("Error response starting container:", {
        status: error.response.status,
        statusText: error.response.statusText,
        body: body,
      });
    } else {
      logger.error("Error starting container:", error);
    }
  }
}

export async function getContainer(id: string): Promise<ContainerInspectResponse | undefined> {
  const client = new ContainerApi();
  const init: RequestInit = defaultRequestInit();

  try {
    return await client.containerInspect({ id }, init);
  } catch (error) {
    if (error instanceof ResponseError) {
      const body = await streamToString(error.response.clone().body);
      logger.error("Error response inspecting container:", {
        status: error.response.status,
        statusText: error.response.statusText,
        body: body,
      });
    } else {
      logger.error("Error inspecting container:", error);
    }
  }
}

export class ContainerExistsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContainerExistsError";
  }
}
