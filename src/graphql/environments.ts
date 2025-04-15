import { graphql } from "gql.tada";
import { workspace, WorkspaceConfiguration } from "vscode";
import { CCLOUD_CONNECTION_ID } from "../constants";
import { logError, showErrorNotificationWithButtons } from "../errors";
import { CCloudEnvironment } from "../models/environment";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import { CCloudKafkaCluster, KafkaCluster } from "../models/kafkaCluster";
import { EnvironmentId } from "../models/resource";
import { CCloudSchemaRegistry } from "../models/schemaRegistry";
import { ENABLE_FLINK } from "../preferences/constants";
import { getSidecar } from "../sidecar";

/**
 * Fetches {@link CCloudEnvironment}s based on a connection ID, sorted by `name`.
 * @remarks Nested `kafkaClusters` are also sorted by name.
 */
export async function getEnvironments(): Promise<CCloudEnvironment[]> {
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
    response = await sidecar.query(query, CCLOUD_CONNECTION_ID, { id: CCLOUD_CONNECTION_ID });
  } catch (error) {
    logError(error, "CCloud environments", { extra: { connectionId: CCLOUD_CONNECTION_ID } });
    showErrorNotificationWithButtons(`Failed to fetch CCloud resources: ${error}`);
    return envs;
  }

  const environments = response.ccloudConnectionById?.environments;
  if (!environments) {
    return envs;
  }

  // TODO: remove this once Flink support is enabled by default
  const config: WorkspaceConfiguration = workspace.getConfiguration();
  const flinkEnabled: boolean = config.get(ENABLE_FLINK, false);

  environments.forEach((env) => {
    if (!env) {
      return;
    }

    // parse Kafka clusters and sort by name
    let kafkaClusters: CCloudKafkaCluster[] = [];
    if (env.kafkaClusters) {
      const envKafkaClusters = env.kafkaClusters.map(
        (cluster: any): CCloudKafkaCluster =>
          CCloudKafkaCluster.create({
            ...cluster,
            environmentId: env.id,
          }),
      );
      envKafkaClusters.sort((a: KafkaCluster, b: KafkaCluster) => a.name.localeCompare(b.name));
      kafkaClusters.push(...envKafkaClusters);
    }

    // parse Schema Registry
    let schemaRegistry: CCloudSchemaRegistry | undefined;
    if (env.schemaRegistry) {
      schemaRegistry = CCloudSchemaRegistry.create({
        ...env.schemaRegistry,
        environmentId: env.id as EnvironmentId,
      });
    }

    // parse Flink Compute Pools
    let flinkComputePools: CCloudFlinkComputePool[] = [];
    if (flinkEnabled && env.flinkComputePools) {
      const envFlinkComputePools = env.flinkComputePools.map(
        (pool: any): CCloudFlinkComputePool =>
          new CCloudFlinkComputePool({
            ...pool,
            environmentId: env.id as EnvironmentId,
            name: pool.display_name,
            maxCfu: pool.max_cfu,
          }),
      );
      flinkComputePools.push(...envFlinkComputePools);
    }

    envs.push(
      new CCloudEnvironment({
        id: env.id as EnvironmentId,
        name: env.name,
        streamGovernancePackage: env.governancePackage,
        kafkaClusters,
        schemaRegistry,
        flinkComputePools,
      }),
    );
  });

  envs.sort((a, b) => a.name.localeCompare(b.name));
  return envs;
}
