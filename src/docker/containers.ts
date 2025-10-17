import type {
  ContainerCreateOperationRequest,
  ContainerCreateResponse,
  ContainerInspectResponse,
  ContainerListRequest,
  ContainerSummary,
} from "../clients/docker";
import { ContainerApi, ResponseError } from "../clients/docker";
import { Logger } from "../logging";
import { defaultRequestInit } from "./configs";
import { MANAGED_CONTAINER_LABEL } from "./constants";
import { imageExists, pullImage } from "./images";

const logger = new Logger("docker.containers");

export async function getContainersForImage(
  request: ContainerListRequest,
): Promise<ContainerSummary[]> {
  const client = new ContainerApi();
  const init: RequestInit = await defaultRequestInit();
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
  const init: RequestInit = await defaultRequestInit();
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
  const init: RequestInit = await defaultRequestInit();

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
  const init: RequestInit = await defaultRequestInit();

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
  const init: RequestInit = await defaultRequestInit();

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

/**
 * Generic health check method for any containerized service.
 */
export async function waitForServiceHealthCheck(
  containerPort: string,
  healthEndpoint: string,
  serviceName: string,
  maxWaitTimeSec: number = 60,
  requestTimeoutMs: number = 5000,
): Promise<boolean> {
  try {
    const healthUrl = `http://localhost:${containerPort}${healthEndpoint}`;
    logger.debug(`Starting ${serviceName} health check at ${healthUrl}`);

    const healthCheckStartTime = Date.now();
    while (Date.now() - healthCheckStartTime < maxWaitTimeSec * 1000) {
      try {
        const response = await fetch(healthUrl, {
          method: "GET",
          signal: AbortSignal.timeout(requestTimeoutMs),
        });

        if (response.ok) {
          logger.debug(`${serviceName} health check succeeded`);
          return true;
        }
        logger.debug(
          `${serviceName} health check failed with status ${response.status}, retrying...`,
        );
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.debug(`${serviceName} health check request failed: ${errorMessage}, retrying...`);
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    logger.warn(`${serviceName} health check timed out after ${maxWaitTimeSec}s`);
    return false;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Critical error during ${serviceName} health check: ${errorMessage}`);
    return false;
  }
}
export function getContainerEnvVars(container: ContainerInspectResponse): Record<string, string> {
  const envVars: Record<string, string> = {};
  container.Config?.Env?.forEach((envVar) => {
    const [key, value] = envVar.split("=");
    envVars[key] = value;
  });
  return envVars;
}

export function getContainerPorts(container: ContainerInspectResponse): Record<string, string> {
  const ports: Record<string, string> = {};
  const portBindings = container.HostConfig?.PortBindings;
  if (portBindings) {
    Object.keys(portBindings).forEach((containerPort) => {
      const hostPort = portBindings[containerPort]?.[0]?.HostPort;
      if (hostPort) {
        ports[containerPort] = hostPort;
      }
    });
  }
  return ports;
}

export function getFirstExternalPort(container: ContainerInspectResponse): string {
  const ports = Object.values(getContainerPorts(container));
  if (ports.length === 0) {
    logger.error("No external ports found for container", { containerId: container.Id });
    return "";
  }
  return ports[0];
}
