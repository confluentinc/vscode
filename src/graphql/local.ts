import { graphql } from "gql.tada";
import { LOCAL_CONNECTION_ID } from "../constants";
import { logError } from "../errors";
import { LocalEnvironment } from "../models/environment";
import { LocalKafkaCluster } from "../models/kafkaCluster";
import { EnvironmentId } from "../models/resource";
import { LocalSchemaRegistry } from "../models/schemaRegistry";
import { showErrorNotificationWithButtons } from "../notifications";
import { getSidecar } from "../sidecar";

export async function getLocalResources(): Promise<LocalEnvironment[]> {
  let envs: LocalEnvironment[] = [];

  const query = graphql(`
    query localConnections {
      localConnections {
        id
        kafkaCluster {
          id
          name
          bootstrapServers
          uri
        }
        schemaRegistry {
          id
          uri
        }
      }
    }
  `);

  const sidecar = await getSidecar();
  let response;
  try {
    response = await sidecar.query(query, LOCAL_CONNECTION_ID);
  } catch (error) {
    logError(error, "local resources", { extra: { connectionId: LOCAL_CONNECTION_ID } });
    showErrorNotificationWithButtons(`Failed to fetch local resources: ${error}`);
    return envs;
  }

  const localConnections = response.localConnections;
  if (!localConnections) {
    return envs;
  }

  // should only be one, but just for consistency with the other environment fetching queries...
  localConnections.forEach((connection) => {
    if (!connection) {
      return;
    }
    // skip over any connection that does't have a Kafka cluster, which may have been previously
    // created (but maybe the Kafka cluster isn't running anymore, etc.)
    if (!connection.kafkaCluster) {
      return;
    }

    let kafkaClusters: LocalKafkaCluster[] = [
      LocalKafkaCluster.create({
        id: connection.kafkaCluster.id,
        name: connection.kafkaCluster.name,
        bootstrapServers: connection.kafkaCluster.bootstrapServers,
        uri: connection.kafkaCluster.uri,
      }),
    ];

    let schemaRegistry: LocalSchemaRegistry | undefined;
    if (connection.schemaRegistry) {
      schemaRegistry = LocalSchemaRegistry.create({
        id: connection.schemaRegistry.id,
        uri: connection.schemaRegistry.uri,
        environmentId: connection.id as EnvironmentId,
      });
    }

    envs.push(
      new LocalEnvironment({
        id: connection.id as EnvironmentId,
        kafkaClusters,
        schemaRegistry,
      }),
    );
  });

  return envs;
}
