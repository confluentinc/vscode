import { graphql } from "gql.tada";
import { LOCAL_CONNECTION_ID, LOCAL_ENVIRONMENT_NAME } from "../constants";
import { logError, showErrorNotificationWithButtons } from "../errors";
import { LocalEnvironment } from "../models/environment";
import { LocalKafkaCluster } from "../models/kafkaCluster";
import { EnvironmentId } from "../models/resource";
import { LocalSchemaRegistry } from "../models/schemaRegistry";
import { getSidecar } from "../sidecar";
import { createLocalConnection, getLocalConnection } from "../sidecar/connections/local";

export async function getLocalResources(): Promise<LocalEnvironment[]> {
  let envs: LocalEnvironment[] = [];

  // this is a bit odd, but we need to have a local "connection" to the sidecar before we can query
  // it for local Kafka clusters, so check if we have a connection first
  if (!(await getLocalConnection())) {
    try {
      await createLocalConnection();
    } catch {
      // error should be caught+logged in createLocalConnection
      // TODO: window.showErrorMessage here? might get noisy since this is triggered from refreshes
      return envs;
    }
  }

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

    let kafkaClusters: LocalKafkaCluster[] = [];
    if (connection.kafkaCluster) {
      kafkaClusters.push(
        LocalKafkaCluster.create({
          id: connection.kafkaCluster.id,
          name: connection.kafkaCluster.name,
          bootstrapServers: connection.kafkaCluster.bootstrapServers,
          uri: connection.kafkaCluster.uri,
        }),
      );
    }

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
        name: LOCAL_ENVIRONMENT_NAME,
        kafkaClusters,
        schemaRegistry,
      }),
    );
  });

  return envs;
}
