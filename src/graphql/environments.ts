import { graphql } from "gql.tada";
import { CCLOUD_CONNECTION_ID } from "../constants";
import { CCloudEnvironment } from "../models/environment";
import { CCloudKafkaCluster, KafkaCluster } from "../models/kafkaCluster";
import { SchemaRegistryCluster } from "../models/schemaRegistry";
import { getSidecar } from "../sidecar";

export interface CCloudEnvironmentGroup {
  environment: CCloudEnvironment;
  kafkaClusters: CCloudKafkaCluster[];
  schemaRegistry?: SchemaRegistryCluster;
  // TODO: Add Flink compute pool as cluster type eventually
}

/**
 * Fetches {@link CCloudEnvironmentGroup}s based on a connection ID, sorted by {@link CCloudEnvironment} name.
 * @remarks Nested `kafkaClusters` are also sorted by name.
 */
export async function getEnvironments(): Promise<CCloudEnvironmentGroup[]> {
  let envGroups: CCloudEnvironmentGroup[] = [];

  const sidecar = await getSidecar();
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
        }
      }
    }
  `);

  const response = await sidecar.query(query, CCLOUD_CONNECTION_ID, { id: CCLOUD_CONNECTION_ID });
  const environments = response.ccloudConnectionById?.environments;
  if (!environments) {
    return envGroups;
  }

  environments.forEach((env: any) => {
    const envGroup: CCloudEnvironmentGroup = {
      environment: CCloudEnvironment.create({
        id: env.id,
        name: env.name,
        stream_governance_package: env.governancePackage,
      }),
      kafkaClusters: [],
      schemaRegistry: undefined,
    };
    // parse Kafka clusters and sort by name
    if (env.kafkaClusters) {
      const envKafkaClusters = env.kafkaClusters.map((cluster: any) =>
        CCloudKafkaCluster.create({
          ...cluster,
          environmentId: env.id,
        }),
      );
      envKafkaClusters.sort((a: KafkaCluster, b: KafkaCluster) => a.name.localeCompare(b.name));
      envGroup.kafkaClusters = envKafkaClusters;
    }
    // parse Schema Registry
    if (env.schemaRegistry) {
      envGroup.schemaRegistry = SchemaRegistryCluster.create({
        ...env.schemaRegistry,
        environmentId: env.id,
      });
    }
    envGroups.push(envGroup);
  });

  envGroups.sort((a, b) => a.environment.name.localeCompare(b.environment.name));
  return envGroups;
}

/**
 * The same as {@link getEnvironments}, but filtered to a specific {@link CCloudEnvironment} and its
 * associated clusters. Uses the connection ID from the given environment to fetch the environments.
 * @param environment The {@link CCloudEnvironment} to filter by.
 * @returns The {@link CCloudEnvironmentGroup} for the given environment, or `null` if no matching
 * environment was found from the GraphQL response.
 * */
export async function getClustersByCCloudEnvironment(
  environment: CCloudEnvironment,
): Promise<CCloudEnvironmentGroup | null> {
  const envGroups: CCloudEnvironmentGroup[] = await getEnvironments();
  return envGroups.find((group) => group.environment.id === environment.id) ?? null;
}
