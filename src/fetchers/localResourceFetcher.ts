/**
 * Local Resource Fetcher Implementation.
 *
 * Discovers local Docker-based Kafka clusters, Schema Registries, and Medusa
 * using the Docker API directly, replacing sidecar's GraphQL queries.
 */

import type { ContainerSummary, Port } from "../clients/docker";
import { ContainerStateStatusEnum } from "../clients/docker";
import { LOCAL_CONNECTION_ID } from "../constants";
import { isDockerAvailable } from "../docker/configs";
import { getContainersForImage } from "../docker/containers";
import { MANAGED_CONTAINER_LABEL } from "../docker/constants";
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
import { LocalEnvironment } from "../models/environment";
import { LocalKafkaCluster } from "../models/kafkaCluster";
import { LocalMedusa } from "../models/medusa";
import type { EnvironmentId } from "../models/resource";
import { LocalSchemaRegistry } from "../models/schemaRegistry";

const logger = new Logger("localResourceFetcher");

/** Default Kafka REST API port. */
const DEFAULT_KAFKA_REST_PORT = 8082;

/** Default Kafka bootstrap port. */
const DEFAULT_KAFKA_BOOTSTRAP_PORT = 9092;

/**
 * Configuration for creating a local resource fetcher.
 */
export interface LocalResourceFetcherConfig {
  /** Request timeout in milliseconds for health checks. */
  healthCheckTimeout?: number;
}

/**
 * Discovered local Kafka cluster information.
 */
export interface DiscoveredKafkaCluster {
  id: string;
  name: string;
  bootstrapServers: string;
  uri?: string;
}

/**
 * Discovered local Schema Registry information.
 */
export interface DiscoveredSchemaRegistry {
  id: string;
  uri: string;
}

/**
 * Discovered local Medusa information.
 */
export interface DiscoveredMedusa {
  uri: string;
}

/**
 * Interface for fetching local resources.
 */
export interface LocalResourceFetcher {
  /**
   * Discover local resources and build a LocalEnvironment.
   * @returns A LocalEnvironment if resources are found, or undefined if Docker is not available.
   */
  discoverResources(): Promise<LocalEnvironment | undefined>;

  /**
   * Discover local Kafka clusters.
   * @returns Array of discovered Kafka clusters.
   */
  discoverKafkaClusters(): Promise<DiscoveredKafkaCluster[]>;

  /**
   * Discover local Schema Registries.
   * @returns Array of discovered Schema Registries.
   */
  discoverSchemaRegistries(): Promise<DiscoveredSchemaRegistry[]>;

  /**
   * Discover local Medusa instances (if enabled).
   * @returns A discovered Medusa instance, or undefined if not found.
   */
  discoverMedusa(): Promise<DiscoveredMedusa | undefined>;

  /**
   * Check if Docker is available.
   * @returns True if Docker is available and responsive.
   */
  isDockerAvailable(): Promise<boolean>;
}

/**
 * Creates a local resource fetcher with the given configuration.
 * @param config Fetcher configuration.
 * @returns A LocalResourceFetcher implementation.
 */
export function createLocalResourceFetcher(
  config: LocalResourceFetcherConfig = {},
): LocalResourceFetcher {
  return new LocalResourceFetcherImpl(config);
}

/**
 * Local resource fetcher implementation.
 */
class LocalResourceFetcherImpl implements LocalResourceFetcher {
  private readonly config: LocalResourceFetcherConfig;

  constructor(config: LocalResourceFetcherConfig) {
    this.config = config;
  }

  /**
   * Discover local resources and build a LocalEnvironment.
   */
  async discoverResources(): Promise<LocalEnvironment | undefined> {
    logger.debug("discovering local resources");

    const dockerAvailable = await this.isDockerAvailable();
    if (!dockerAvailable) {
      logger.debug("Docker is not available, skipping local resource discovery");
      return undefined;
    }

    // Discover resources in parallel
    const [kafkaClusters, schemaRegistries, medusa] = await Promise.all([
      this.discoverKafkaClusters(),
      this.discoverSchemaRegistries(),
      this.discoverMedusa(),
    ]);

    // If no resources found, return undefined
    if (kafkaClusters.length === 0 && schemaRegistries.length === 0 && !medusa) {
      logger.debug("no local resources discovered");
      return undefined;
    }

    // Build LocalEnvironment
    const localKafkaClusters = kafkaClusters.map((cluster) =>
      LocalKafkaCluster.create({
        id: cluster.id,
        name: cluster.name,
        bootstrapServers: cluster.bootstrapServers,
        uri: cluster.uri,
      }),
    );

    let localSchemaRegistry: LocalSchemaRegistry | undefined;
    if (schemaRegistries.length > 0) {
      // Only use the first Schema Registry (like the current implementation)
      const sr = schemaRegistries[0];
      localSchemaRegistry = LocalSchemaRegistry.create({
        id: sr.id,
        uri: sr.uri,
        environmentId: LOCAL_CONNECTION_ID as unknown as EnvironmentId,
      });
    }

    let localMedusa: LocalMedusa | undefined;
    if (medusa) {
      localMedusa = LocalMedusa.create({
        uri: medusa.uri,
      });
    }

    const environment = new LocalEnvironment({
      id: LOCAL_CONNECTION_ID as unknown as EnvironmentId,
      kafkaClusters: localKafkaClusters,
      schemaRegistry: localSchemaRegistry,
      medusa: localMedusa,
    });

    logger.debug("discovered local environment", {
      kafkaClusters: localKafkaClusters.length,
      hasSchemaRegistry: !!localSchemaRegistry,
      hasMedusa: !!localMedusa,
    });

    return environment;
  }

  /**
   * Discover local Kafka clusters.
   */
  async discoverKafkaClusters(): Promise<DiscoveredKafkaCluster[]> {
    logger.debug("discovering local Kafka clusters");

    const dockerAvailable = await this.isDockerAvailable();
    if (!dockerAvailable) {
      return [];
    }

    const imageRepo = LOCAL_KAFKA_IMAGE.value;
    const imageTag = LOCAL_KAFKA_IMAGE_TAG.value;

    const containers = await this.getRunningContainers(imageRepo, imageTag);
    if (containers.length === 0) {
      logger.debug("no local Kafka containers found");
      return [];
    }

    const clusters: DiscoveredKafkaCluster[] = [];
    for (const container of containers) {
      const cluster = this.containerToKafkaCluster(container);
      if (cluster) {
        clusters.push(cluster);
      }
    }

    logger.debug(`discovered ${clusters.length} local Kafka cluster(s)`);
    return clusters;
  }

  /**
   * Discover local Schema Registries.
   */
  async discoverSchemaRegistries(): Promise<DiscoveredSchemaRegistry[]> {
    logger.debug("discovering local Schema Registries");

    const dockerAvailable = await this.isDockerAvailable();
    if (!dockerAvailable) {
      return [];
    }

    const imageRepo = LOCAL_SCHEMA_REGISTRY_IMAGE.value;
    const imageTag = LOCAL_SCHEMA_REGISTRY_IMAGE_TAG.value;

    const containers = await this.getRunningContainers(imageRepo, imageTag);
    if (containers.length === 0) {
      logger.debug("no local Schema Registry containers found");
      return [];
    }

    const registries: DiscoveredSchemaRegistry[] = [];
    for (const container of containers) {
      const registry = this.containerToSchemaRegistry(container);
      if (registry) {
        registries.push(registry);
      }
    }

    logger.debug(`discovered ${registries.length} local Schema Registry(s)`);
    return registries;
  }

  /**
   * Discover local Medusa instances.
   */
  async discoverMedusa(): Promise<DiscoveredMedusa | undefined> {
    // Check if Medusa is enabled in settings
    if (!ENABLE_MEDUSA_CONTAINER.value) {
      return undefined;
    }

    logger.debug("discovering local Medusa");

    const dockerAvailable = await this.isDockerAvailable();
    if (!dockerAvailable) {
      return undefined;
    }

    const imageRepo = LOCAL_MEDUSA_IMAGE.value;
    const imageTag = LOCAL_MEDUSA_IMAGE_TAG.value;

    if (!imageRepo || !imageTag) {
      return undefined;
    }

    const containers = await this.getRunningContainers(imageRepo, imageTag);
    if (containers.length === 0) {
      logger.debug("no local Medusa containers found");
      return undefined;
    }

    // Use the first container with ports
    const container = containers.find((c) => c.Ports && c.Ports.length > 0);
    if (!container) {
      return undefined;
    }

    const port = this.getFirstPublicPort(container);
    if (!port) {
      return undefined;
    }

    const medusa: DiscoveredMedusa = {
      uri: `http://localhost:${port}`,
    };

    logger.debug("discovered local Medusa", { uri: medusa.uri });
    return medusa;
  }

  /**
   * Check if Docker is available.
   */
  async isDockerAvailable(): Promise<boolean> {
    return await isDockerAvailable();
  }

  /**
   * Get running containers for a specific image.
   */
  private async getRunningContainers(
    imageRepo: string,
    imageTag: string,
  ): Promise<ContainerSummary[]> {
    const repoTag = `${imageRepo}:${imageTag}`;
    const filters = {
      ancestor: [repoTag],
      label: [MANAGED_CONTAINER_LABEL],
      status: [ContainerStateStatusEnum.Running],
    };

    try {
      return await getContainersForImage({
        all: true,
        filters: JSON.stringify(filters),
      });
    } catch (error) {
      logger.warn(`failed to list containers for ${repoTag}`, { error });
      return [];
    }
  }

  /**
   * Convert a container to a Kafka cluster.
   */
  private containerToKafkaCluster(container: ContainerSummary): DiscoveredKafkaCluster | undefined {
    if (!container.Id) {
      return undefined;
    }

    // Get the container name (remove leading slash)
    const name = container.Names?.[0]?.replace(/^\//, "") ?? "Local Kafka";

    // Find the REST API port (8082) and bootstrap port (9092)
    const restPort = this.findPortMapping(container, DEFAULT_KAFKA_REST_PORT);
    const bootstrapPort = this.findPortMapping(container, DEFAULT_KAFKA_BOOTSTRAP_PORT);

    if (!bootstrapPort) {
      logger.debug("no bootstrap port found for Kafka container", { containerId: container.Id });
      return undefined;
    }

    const cluster: DiscoveredKafkaCluster = {
      id: container.Id.substring(0, 12), // Use short container ID
      name,
      bootstrapServers: `localhost:${bootstrapPort}`,
      uri: restPort ? `http://localhost:${restPort}` : undefined,
    };

    return cluster;
  }

  /**
   * Convert a container to a Schema Registry.
   */
  private containerToSchemaRegistry(
    container: ContainerSummary,
  ): DiscoveredSchemaRegistry | undefined {
    if (!container.Id) {
      return undefined;
    }

    const port = this.getFirstPublicPort(container);
    if (!port) {
      logger.debug("no port found for Schema Registry container", { containerId: container.Id });
      return undefined;
    }

    const registry: DiscoveredSchemaRegistry = {
      id: container.Id.substring(0, 12), // Use short container ID
      uri: `http://localhost:${port}`,
    };

    return registry;
  }

  /**
   * Find the host port mapping for a specific container port.
   */
  private findPortMapping(container: ContainerSummary, containerPort: number): number | undefined {
    const ports = container.Ports?.filter((p) => p.PrivatePort === containerPort && p.PublicPort);
    if (!ports || ports.length === 0) {
      return undefined;
    }
    return ports[0].PublicPort;
  }

  /**
   * Get the first public port from a container.
   */
  private getFirstPublicPort(container: ContainerSummary): number | undefined {
    const ports: Port[] = container.Ports?.filter((p) => !!p.PublicPort) || [];
    if (ports.length === 0) {
      return undefined;
    }
    return ports[0].PublicPort;
  }
}
