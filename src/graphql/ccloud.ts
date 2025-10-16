import { graphql } from "gql.tada";
import { CCLOUD_CONNECTION_ID } from "../constants";
import { logError } from "../errors";
import { CCloudEnvironment } from "../models/environment";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import type { KafkaCluster } from "../models/kafkaCluster";
import { CCloudKafkaCluster } from "../models/kafkaCluster";
import type { EnvironmentId } from "../models/resource";
import { CCloudSchemaRegistry } from "../models/schemaRegistry";
import { showErrorNotificationWithButtons } from "../notifications";
import { getSidecar } from "../sidecar";

/**
 * Fetches {@link CCloudEnvironment}s based on a connection ID, sorted by `name`.
 * @remarks Nested `kafkaClusters` are also sorted by name.
 */
export async function getCCloudResources(): Promise<CCloudEnvironment[]> {
  let envs: CCloudEnvironment[] = [];

  const query = graphql(`
    query environments($id: String!) {
      ccloudConnectionById(id: $id) {
        environments {
          id
          name
          governancePackage
          kafkaClusters {
            id
            name
            provider
            region
            bootstrapServers
            uri
          }
          schemaRegistry {
            id
            provider
            region
            uri
          }
          flinkComputePools {
            id
            display_name
            provider
            region
            max_cfu
          }
        }
      }
    }
  `);

  const sidecar = await getSidecar();
  let response;
  try {
    response = await sidecar.query(query, CCLOUD_CONNECTION_ID, true, { id: CCLOUD_CONNECTION_ID });
  } catch (error) {
    logError(error, "CCloud environments", { extra: { connectionId: CCLOUD_CONNECTION_ID } });
    void showErrorNotificationWithButtons(`Failed to fetch CCloud resources: ${error}`);
    return envs;
  }

  const environments = response.ccloudConnectionById?.environments;
  if (!environments) {
    return envs;
  }

  // First, extract out all Flink pools so we can associate them with Kafka clusters *across* environments
  const flinkComputePoolsByEnv: Map<EnvironmentId, CCloudFlinkComputePool[]> = new Map();
  const flinkComputePoolsByCloudRegion: Map<string, CCloudFlinkComputePool[]> = new Map();
  environments.forEach((env) => {
    if (!env) {
      return;
    }
    if (env.flinkComputePools && env.flinkComputePools.length > 0) {
      const envFlinkComputePools = env.flinkComputePools.map(
        (pool: any): CCloudFlinkComputePool =>
          new CCloudFlinkComputePool({
            ...pool,
            environmentId: env.id as EnvironmentId,
            name: pool.display_name,
            maxCfu: pool.max_cfu,
          }),
      );
      flinkComputePoolsByEnv.set(env.id as EnvironmentId, envFlinkComputePools);

      // Also index by "provider/region" for cross-env lookup
      envFlinkComputePools.forEach((pool) => {
        const key = `${pool.provider}/${pool.region}`;
        const existing = flinkComputePoolsByCloudRegion.get(key) || [];
        existing.push(pool);
        flinkComputePoolsByCloudRegion.set(key, existing);
      });
    }
  });

  environments.forEach((env) => {
    if (!env) {
      return;
    }

    const envId = env.id as EnvironmentId;

    // parse Kafka clusters and sort by name
    let kafkaClusters: CCloudKafkaCluster[] = [];
    if (env.kafkaClusters && env.kafkaClusters.length > 0) {
      const envKafkaClusters = env.kafkaClusters.map((cluster: any): CCloudKafkaCluster => {
        // Associate Flink compute pools with the same provider/region
        const matchingFlinkPools = flinkComputePoolsByCloudRegion
          .get(`${cluster.provider}/${cluster.region}`)
          ?.slice(); // slice() to clone array so that each CCloudKafkaCluster has its own copy.

        return CCloudKafkaCluster.create({
          ...cluster,
          environmentId: envId,
          flinkPools: matchingFlinkPools,
        });
      });
      envKafkaClusters.sort((a: KafkaCluster, b: KafkaCluster) => a.name.localeCompare(b.name));
      kafkaClusters.push(...envKafkaClusters);
    }

    // parse Schema Registry
    let schemaRegistry: CCloudSchemaRegistry | undefined;
    if (env.schemaRegistry) {
      schemaRegistry = CCloudSchemaRegistry.create({
        ...env.schemaRegistry,
        environmentId: envId,
      });
    }

    envs.push(
      new CCloudEnvironment({
        id: envId,
        name: env.name,
        streamGovernancePackage: env.governancePackage,
        kafkaClusters,
        schemaRegistry,
        flinkComputePools: flinkComputePoolsByEnv.get(envId) || [],
      }),
    );
  });

  envs.sort((a, b) => a.name.localeCompare(b.name));
  return envs;
}
