/**
 * Local Docker resource utilities.
 *
 * Provides functions for working with local Docker-based Kafka resources.
 * These functions were previously in src/sidecar/connections/local.ts.
 */

import type { ContainerSummary, Port } from "../clients/docker";
import { ContainerStateStatusEnum } from "../clients/docker";
import { getContainersForImage } from "./containers";
import {
  LOCAL_KAFKA_IMAGE,
  LOCAL_KAFKA_IMAGE_TAG,
  LOCAL_MEDUSA_IMAGE,
  LOCAL_MEDUSA_IMAGE_TAG,
  LOCAL_SCHEMA_REGISTRY_IMAGE,
  LOCAL_SCHEMA_REGISTRY_IMAGE_TAG,
  ENABLE_MEDUSA_CONTAINER,
} from "../extensionSettings/constants";
import { Logger } from "../logging";
import { LocalResourceLoader } from "../loaders";

const logger = new Logger("docker.local");

/** Options for filtering containers by image. */
export interface ContainerFilterOptions {
  /** Only include containers managed by this extension. */
  onlyExtensionManaged?: boolean;
  /** Filter by container statuses (empty array = all statuses). */
  statuses?: string[];
}

/**
 * Gets containers for a specific image and tag.
 * Used by workflow classes to find containers for their specific image.
 * @param imageRepo Docker image repository.
 * @param imageTag Docker image tag.
 * @param options Filter options.
 * @returns Array of matching container summaries.
 */
export async function getContainersForImageAndTag(
  imageRepo: string,
  imageTag: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _options?: ContainerFilterOptions,
): Promise<ContainerSummary[]> {
  const image = `${imageRepo}:${imageTag}`;
  return await getContainersForImage({
    filters: JSON.stringify({ ancestor: [image] }),
  });
}

/**
 * Interface representing a local resource container.
 */
export interface LocalResourceContainer {
  /** Container ID. */
  id: string;
  /** Container name. */
  name: string;
  /** Container image. */
  image: string;
  /** Container status. */
  status: string;
  /** Container ports. */
  ports: Port[];
}

/**
 * Gets all local resource containers (Kafka, Schema Registry, Medusa).
 * @returns Array of local resource containers.
 */
export async function getLocalResourceContainers(): Promise<LocalResourceContainer[]> {
  const containers: LocalResourceContainer[] = [];

  // Get Kafka containers
  const kafkaImage = `${LOCAL_KAFKA_IMAGE.value}:${LOCAL_KAFKA_IMAGE_TAG.value}`;
  const kafkaContainers = await getContainersForImage({
    filters: JSON.stringify({ ancestor: [kafkaImage] }),
  });
  for (const container of kafkaContainers) {
    if (container.State === ContainerStateStatusEnum.Running) {
      containers.push(containerSummaryToLocalContainer(container));
    }
  }

  // Get Schema Registry containers
  const srImage = `${LOCAL_SCHEMA_REGISTRY_IMAGE.value}:${LOCAL_SCHEMA_REGISTRY_IMAGE_TAG.value}`;
  const srContainers = await getContainersForImage({
    filters: JSON.stringify({ ancestor: [srImage] }),
  });
  for (const container of srContainers) {
    if (container.State === ContainerStateStatusEnum.Running) {
      containers.push(containerSummaryToLocalContainer(container));
    }
  }

  // Get Medusa containers if enabled
  if (ENABLE_MEDUSA_CONTAINER.value) {
    const medusaImage = `${LOCAL_MEDUSA_IMAGE.value}:${LOCAL_MEDUSA_IMAGE_TAG.value}`;
    const medusaContainers = await getContainersForImage({
      filters: JSON.stringify({ ancestor: [medusaImage] }),
    });
    for (const container of medusaContainers) {
      if (container.State === ContainerStateStatusEnum.Running) {
        containers.push(containerSummaryToLocalContainer(container));
      }
    }
  }

  return containers;
}

/**
 * Converts a Docker ContainerSummary to LocalResourceContainer.
 */
function containerSummaryToLocalContainer(container: ContainerSummary): LocalResourceContainer {
  return {
    id: container.Id ?? "",
    name: container.Names?.[0]?.replace(/^\//, "") ?? "",
    image: container.Image ?? "",
    status: container.State ?? "",
    ports: container.Ports ?? [],
  };
}

/**
 * Updates the local connection by refreshing resources from Docker.
 * This triggers a reload of local resources in the resource loader.
 * @param schemaRegistryUri Optional Schema Registry URI hint (not currently used).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function updateLocalConnection(_schemaRegistryUri?: string): Promise<void> {
  logger.info("Updating local connection resources");
  const loader = LocalResourceLoader.getInstance();
  await loader.reset();
}

/**
 * Gets the Medusa container if running.
 * @returns The Medusa container, or undefined if not running.
 */
export async function getMedusaContainer(): Promise<LocalResourceContainer | undefined> {
  if (!ENABLE_MEDUSA_CONTAINER.value) {
    return undefined;
  }

  const medusaImage = `${LOCAL_MEDUSA_IMAGE.value}:${LOCAL_MEDUSA_IMAGE_TAG.value}`;
  const containers = await getContainersForImage({
    filters: JSON.stringify({ ancestor: [medusaImage] }),
  });

  const running = containers.find((c) => c.State === ContainerStateStatusEnum.Running);
  return running ? containerSummaryToLocalContainer(running) : undefined;
}

/**
 * Gets the public port mapping for a container's internal port.
 * @param container The container to get the port for.
 * @param privatePort The internal port to look up.
 * @returns The public port number, or undefined if not mapped.
 */
export function getContainerPublicPort(
  container: LocalResourceContainer,
  privatePort: number,
): number | undefined {
  const portMapping = container.ports.find((p) => p.PrivatePort === privatePort);
  return portMapping?.PublicPort ?? undefined;
}

/**
 * Gets local Kafka containers.
 * @returns Array of Kafka containers.
 */
export async function getLocalKafkaContainers(): Promise<LocalResourceContainer[]> {
  const kafkaImage = `${LOCAL_KAFKA_IMAGE.value}:${LOCAL_KAFKA_IMAGE_TAG.value}`;
  const containers = await getContainersForImage({
    filters: JSON.stringify({ ancestor: [kafkaImage] }),
  });
  return containers
    .filter((c) => c.State === ContainerStateStatusEnum.Running)
    .map(containerSummaryToLocalContainer);
}

/**
 * Gets local Schema Registry containers.
 * @returns Array of Schema Registry containers.
 */
export async function getLocalSchemaRegistryContainers(): Promise<LocalResourceContainer[]> {
  const srImage = `${LOCAL_SCHEMA_REGISTRY_IMAGE.value}:${LOCAL_SCHEMA_REGISTRY_IMAGE_TAG.value}`;
  const containers = await getContainersForImage({
    filters: JSON.stringify({ ancestor: [srImage] }),
  });
  return containers
    .filter((c) => c.State === ContainerStateStatusEnum.Running)
    .map(containerSummaryToLocalContainer);
}
