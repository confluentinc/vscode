/**
 * CCloud Resource Fetcher Implementation.
 *
 * Fetches environments, Kafka clusters, Schema Registries, and Flink compute pools
 * from Confluent Cloud using the CCloud Control Plane API proxy.
 * Replaces sidecar's GraphQL queries during migration.
 */

import type { AuthConfig } from "../proxy";
import {
  createCCloudControlPlaneProxy,
  type CCloudControlPlaneProxy,
  type CCloudEnvironmentData,
  type CCloudFlinkComputePoolData,
  type CCloudKafkaClusterData,
  type CCloudSchemaRegistryData,
} from "../proxy";
import { CCLOUD_CONNECTION_ID } from "../constants";
import { CCloudEnvironment } from "../models/environment";
import { CCloudKafkaCluster } from "../models/kafkaCluster";
import { CCloudSchemaRegistry } from "../models/schemaRegistry";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import type { EnvironmentId } from "../models/resource";
import { Logger } from "../logging";

const logger = new Logger("ccloudResourceFetcher");

/** Default CCloud Control Plane API URL. */
const CCLOUD_CONTROL_PLANE_URL = "https://api.confluent.cloud";

/**
 * Configuration for creating a CCloud resource fetcher.
 */
export interface CCloudResourceFetcherConfig {
  /** Function to get the current OAuth access token. */
  getAccessToken: () => Promise<string | undefined>;
  /** Base URL for the Control Plane API. */
  baseUrl?: string;
  /** Request timeout in milliseconds. */
  timeout?: number;
}

/**
 * Interface for fetching CCloud resources.
 */
export interface CCloudResourceFetcher {
  /**
   * Fetch all environments with their nested resources.
   * @returns Array of CCloudEnvironment instances.
   */
  fetchEnvironments(): Promise<CCloudEnvironment[]>;

  /**
   * Fetch Kafka clusters for a specific environment.
   * @param environmentId The environment ID.
   * @returns Array of CCloudKafkaCluster instances.
   */
  fetchKafkaClusters(environmentId: EnvironmentId): Promise<CCloudKafkaCluster[]>;

  /**
   * Fetch Schema Registries for a specific environment.
   * @param environmentId The environment ID.
   * @returns Array of CCloudSchemaRegistry instances (usually 0 or 1).
   */
  fetchSchemaRegistries(environmentId: EnvironmentId): Promise<CCloudSchemaRegistry[]>;

  /**
   * Fetch Flink compute pools for a specific environment.
   * @param environmentId The environment ID.
   * @returns Array of CCloudFlinkComputePool instances.
   */
  fetchFlinkComputePools(environmentId: EnvironmentId): Promise<CCloudFlinkComputePool[]>;
}

/**
 * Creates a CCloud resource fetcher with the given configuration.
 * @param config Fetcher configuration.
 * @returns A CCloudResourceFetcher implementation.
 */
export function createCCloudResourceFetcher(
  config: CCloudResourceFetcherConfig,
): CCloudResourceFetcher {
  return new CCloudResourceFetcherImpl(config);
}

/**
 * CCloud resource fetcher implementation.
 */
class CCloudResourceFetcherImpl implements CCloudResourceFetcher {
  private readonly config: CCloudResourceFetcherConfig;
  private readonly baseUrl: string;

  constructor(config: CCloudResourceFetcherConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl ?? CCLOUD_CONTROL_PLANE_URL;
  }

  /**
   * Fetch all environments with their nested resources.
   */
  async fetchEnvironments(): Promise<CCloudEnvironment[]> {
    logger.debug("fetching CCloud environments");

    const proxy = await this.createProxy();

    // Fetch environments
    const envData = await proxy.fetchAllEnvironments();
    logger.debug(`fetched ${envData.length} environment(s) from CCloud`);

    // For each environment, fetch its nested resources concurrently
    const environments = await Promise.all(envData.map((env) => this.buildEnvironment(proxy, env)));

    // Sort by name
    environments.sort((a, b) => a.name.localeCompare(b.name));

    return environments;
  }

  /**
   * Fetch Kafka clusters for a specific environment.
   */
  async fetchKafkaClusters(environmentId: EnvironmentId): Promise<CCloudKafkaCluster[]> {
    logger.debug(`fetching Kafka clusters for environment ${environmentId}`);

    const proxy = await this.createProxy();
    const clustersData = await proxy.fetchAllKafkaClusters(environmentId);

    return clustersData.map((cluster) => this.toCCloudKafkaCluster(cluster, environmentId));
  }

  /**
   * Fetch Schema Registries for a specific environment.
   */
  async fetchSchemaRegistries(environmentId: EnvironmentId): Promise<CCloudSchemaRegistry[]> {
    logger.debug(`fetching Schema Registries for environment ${environmentId}`);

    const proxy = await this.createProxy();
    const srData = await proxy.fetchAllSchemaRegistries(environmentId);

    return srData.map((sr) => this.toCCloudSchemaRegistry(sr, environmentId));
  }

  /**
   * Fetch Flink compute pools for a specific environment.
   */
  async fetchFlinkComputePools(environmentId: EnvironmentId): Promise<CCloudFlinkComputePool[]> {
    logger.debug(`fetching Flink compute pools for environment ${environmentId}`);

    const proxy = await this.createProxy();
    const poolsData = await proxy.fetchAllFlinkComputePools(environmentId);

    return poolsData.map((pool) => this.toCCloudFlinkComputePool(pool, environmentId));
  }

  /**
   * Build a CCloudEnvironment with all its nested resources.
   */
  private async buildEnvironment(
    proxy: CCloudControlPlaneProxy,
    envData: CCloudEnvironmentData,
  ): Promise<CCloudEnvironment> {
    const environmentId = envData.id as EnvironmentId;

    // Fetch all nested resources concurrently
    const [clustersData, srData, poolsData] = await Promise.all([
      proxy.fetchAllKafkaClusters(environmentId),
      proxy.fetchAllSchemaRegistries(environmentId),
      proxy.fetchAllFlinkComputePools(environmentId),
    ]);

    // Convert Flink pools first (needed for cluster creation)
    const flinkComputePools = poolsData.map((pool) =>
      this.toCCloudFlinkComputePool(pool, environmentId),
    );

    // Convert Kafka clusters with their associated Flink pools
    const kafkaClusters = clustersData.map((cluster) => {
      const clusterProvider = cluster.spec?.cloud?.toLowerCase() ?? "";
      const clusterRegion = cluster.spec?.region?.toLowerCase() ?? "";

      // Find Flink pools in same provider/region
      const matchingPools = flinkComputePools.filter(
        (pool) =>
          pool.provider.toLowerCase() === clusterProvider &&
          pool.region.toLowerCase() === clusterRegion,
      );

      return this.toCCloudKafkaCluster(cluster, environmentId, matchingPools);
    });

    const schemaRegistries = srData.map((sr) => this.toCCloudSchemaRegistry(sr, environmentId));

    return new CCloudEnvironment({
      id: environmentId,
      name: envData.display_name ?? envData.id,
      streamGovernancePackage: envData.stream_governance_config?.package ?? "NONE",
      kafkaClusters,
      schemaRegistry: schemaRegistries[0], // At most one SR per environment
      flinkComputePools,
    });
  }

  /**
   * Convert API response to CCloudKafkaCluster model.
   */
  private toCCloudKafkaCluster(
    data: CCloudKafkaClusterData,
    environmentId: EnvironmentId,
    flinkPools?: CCloudFlinkComputePool[],
  ): CCloudKafkaCluster {
    return CCloudKafkaCluster.create({
      id: data.id,
      name: data.spec?.display_name ?? data.id,
      bootstrapServers: data.spec?.kafka_bootstrap_endpoint ?? "",
      uri: data.spec?.http_endpoint,
      provider: data.spec?.cloud ?? "unknown",
      region: data.spec?.region ?? "unknown",
      environmentId,
      flinkPools,
    });
  }

  /**
   * Convert API response to CCloudSchemaRegistry model.
   */
  private toCCloudSchemaRegistry(
    data: CCloudSchemaRegistryData,
    environmentId: EnvironmentId,
  ): CCloudSchemaRegistry {
    return CCloudSchemaRegistry.create({
      id: data.id,
      uri: data.spec?.http_endpoint ?? "",
      provider: data.spec?.cloud ?? "unknown",
      region: data.spec?.region ?? "unknown",
      environmentId,
    });
  }

  /**
   * Convert API response to CCloudFlinkComputePool model.
   */
  private toCCloudFlinkComputePool(
    data: CCloudFlinkComputePoolData,
    environmentId: EnvironmentId,
  ): CCloudFlinkComputePool {
    return new CCloudFlinkComputePool({
      id: data.id,
      name: data.spec?.display_name ?? data.id,
      provider: data.spec?.cloud ?? "unknown",
      region: data.spec?.region ?? "unknown",
      maxCfu: data.spec?.max_cfu ?? 0,
      environmentId,
    });
  }

  /**
   * Creates a CCloud Control Plane proxy with current auth.
   */
  private async createProxy(): Promise<CCloudControlPlaneProxy> {
    const token = await this.config.getAccessToken();
    const auth: AuthConfig | undefined = token ? { type: "bearer", token } : undefined;

    return createCCloudControlPlaneProxy({
      baseUrl: this.baseUrl,
      auth,
      timeout: this.config.timeout,
    });
  }
}

// Re-export CCLOUD_CONNECTION_ID for convenience
export { CCLOUD_CONNECTION_ID };
