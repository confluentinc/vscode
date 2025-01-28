import { graphql } from "gql.tada";
import { CCLOUD_CONNECTION_ID } from "../constants";
import { logError, showErrorNotificationWithButtons } from "../errors";
import { CCloudEnvironment } from "../models/environment";
import { CCloudKafkaCluster, KafkaCluster } from "../models/kafkaCluster";
import { CCloudSchemaRegistry } from "../models/schemaRegistry";
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
        }
      }
    }
  `);

  const sidecar = await getSidecar();
  let response;
  try {
    response = await sidecar.query(query, CCLOUD_CONNECTION_ID, { id: CCLOUD_CONNECTION_ID });
  } catch (error) {
    logError(error, "CCloud environments", { connectionId: CCLOUD_CONNECTION_ID }, true);
    showErrorNotificationWithButtons(`Failed to fetch CCloud resources: ${error}`);
    return envs;
  }

  const environments = response.ccloudConnectionById?.environments;
  if (!environments) {
    return envs;
  }

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
        environmentId: env.id,
      });
    }

    envs.push(
      new CCloudEnvironment({
        id: env.id,
        name: env.name,
        streamGovernancePackage: env.governancePackage,
        kafkaClusters,
        schemaRegistry,
      }),
    );
  });

  envs.sort((a, b) => a.name.localeCompare(b.name));
  return envs;
}
