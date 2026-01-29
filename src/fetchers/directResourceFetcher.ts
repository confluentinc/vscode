/**
 * Direct Resource Fetcher Implementation.
 *
 * Builds DirectEnvironment from connection specifications stored in ResourceManager.
 * Replaces sidecar's GraphQL queries for direct connections.
 */

import { ConnectionType } from "../connections";
import { Logger } from "../logging";
import { DirectEnvironment } from "../models/environment";
import { DirectKafkaCluster } from "../models/kafkaCluster";
import type { ConnectionId, EnvironmentId } from "../models/resource";
import { DirectSchemaRegistry } from "../models/schemaRegistry";
import type { CustomConnectionSpec } from "../storage/resourceManager";

const logger = new Logger("directResourceFetcher");

/**
 * Configuration for creating a direct resource fetcher.
 */
export interface DirectResourceFetcherConfig {
  /**
   * Function to get a direct connection spec by ID.
   * This allows decoupling from ResourceManager for testing.
   */
  getConnectionSpec: (connectionId: ConnectionId) => Promise<CustomConnectionSpec | null>;
}

/**
 * Interface for fetching direct connection resources.
 */
export interface DirectResourceFetcher {
  /**
   * Build a DirectEnvironment from a connection spec.
   * @param connectionId The connection ID.
   * @returns A DirectEnvironment if the connection exists, or undefined.
   */
  buildEnvironment(connectionId: ConnectionId): Promise<DirectEnvironment | undefined>;

  /**
   * Build a DirectEnvironment from a provided connection spec.
   * @param spec The connection specification.
   * @returns A DirectEnvironment built from the spec.
   */
  buildEnvironmentFromSpec(spec: CustomConnectionSpec): DirectEnvironment;
}

/**
 * Creates a direct resource fetcher with the given configuration.
 * @param config Fetcher configuration.
 * @returns A DirectResourceFetcher implementation.
 */
export function createDirectResourceFetcher(
  config: DirectResourceFetcherConfig,
): DirectResourceFetcher {
  return new DirectResourceFetcherImpl(config);
}

/**
 * Direct resource fetcher implementation.
 */
class DirectResourceFetcherImpl implements DirectResourceFetcher {
  private readonly config: DirectResourceFetcherConfig;

  constructor(config: DirectResourceFetcherConfig) {
    this.config = config;
  }

  /**
   * Build a DirectEnvironment from a connection spec.
   */
  async buildEnvironment(connectionId: ConnectionId): Promise<DirectEnvironment | undefined> {
    logger.debug(`building environment for direct connection ${connectionId}`);

    const spec = await this.config.getConnectionSpec(connectionId);
    if (!spec) {
      logger.debug(`no connection spec found for ${connectionId}`);
      return undefined;
    }

    return this.buildEnvironmentFromSpec(spec);
  }

  /**
   * Build a DirectEnvironment from a provided connection spec.
   */
  buildEnvironmentFromSpec(spec: CustomConnectionSpec): DirectEnvironment {
    const connectionId = spec.id;
    const connectionInfo = {
      connectionId,
      connectionType: ConnectionType.Direct,
    };

    let kafkaCluster: DirectKafkaCluster | undefined;
    if (spec.kafkaCluster) {
      // Generate a cluster ID from the bootstrap servers if not provided
      const clusterId = this.generateClusterId(spec.kafkaCluster.bootstrapServers);

      kafkaCluster = DirectKafkaCluster.create({
        id: clusterId,
        name: spec.name || "Kafka Cluster",
        bootstrapServers: spec.kafkaCluster.bootstrapServers,
        ...connectionInfo,
      });
    }

    let schemaRegistry: DirectSchemaRegistry | undefined;
    if (spec.schemaRegistry) {
      // Generate a registry ID from the URI if not provided
      const registryId = this.generateRegistryId(spec.schemaRegistry.uri);

      schemaRegistry = DirectSchemaRegistry.create({
        id: registryId,
        uri: spec.schemaRegistry.uri,
        environmentId: connectionId as unknown as EnvironmentId,
        ...connectionInfo,
      });
    }

    const environment = new DirectEnvironment({
      id: connectionId as unknown as EnvironmentId,
      name: spec.name || "Direct Connection",
      kafkaClusters: kafkaCluster ? [kafkaCluster] : [],
      kafkaConfigured: !!spec.kafkaCluster,
      schemaRegistry,
      schemaRegistryConfigured: !!spec.schemaRegistry,
      formConnectionType: spec.formConnectionType,
      ...connectionInfo,
    });

    logger.debug("built direct environment", {
      connectionId,
      name: environment.name,
      hasKafkaCluster: !!kafkaCluster,
      hasSchemaRegistry: !!schemaRegistry,
    });

    return environment;
  }

  /**
   * Generate a cluster ID from bootstrap servers.
   * Uses a hash of the bootstrap servers string.
   */
  private generateClusterId(bootstrapServers: string): string {
    // Simple hash function for generating consistent IDs
    let hash = 0;
    for (let i = 0; i < bootstrapServers.length; i++) {
      const char = bootstrapServers.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return `direct-kafka-${Math.abs(hash).toString(16)}`;
  }

  /**
   * Generate a registry ID from the URI.
   * Uses a hash of the URI string.
   */
  private generateRegistryId(uri: string): string {
    // Simple hash function for generating consistent IDs
    let hash = 0;
    for (let i = 0; i < uri.length; i++) {
      const char = uri.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return `direct-sr-${Math.abs(hash).toString(16)}`;
  }
}
