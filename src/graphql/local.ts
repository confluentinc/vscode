import { graphql } from "gql.tada";
import { LOCAL_CONNECTION_ID } from "../constants";
import { logError } from "../errors";
import { LocalEnvironment } from "../models/environment";
import { LocalKafkaCluster } from "../models/kafkaCluster";
import { LocalMedusa } from "../models/medusa";
import { EnvironmentId } from "../models/resource";
import { LocalSchemaRegistry } from "../models/schemaRegistry";
import { showErrorNotificationWithButtons } from "../notifications";
import { getSidecar } from "../sidecar";
import { discoverMedusa } from "../sidecar/connections/local";

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
    // Call with showPartialErrors=false to suppress error notifications for partial errors,
    // which are expected for local connection if we're starting up both kafka and schema registry
    // containers, but just queried sidecar and it could only contact Kafka (SR still coming online).
    // When docker SR does come online, we'll re-query again and be happy.
    response = await sidecar.query(query, LOCAL_CONNECTION_ID, false);
  } catch (error) {
    logError(error, "local resources", { extra: { connectionId: LOCAL_CONNECTION_ID } });
    showErrorNotificationWithButtons(`Failed to fetch local resources: ${error}`);
    return envs;
  }

  const localConnections = response.localConnections;

  // Check for Medusa independently of sidecar connections
  const medusaUri = await discoverMedusa();

  // Handle case where we have sidecar-managed resources (Kafka/Schema Registry)
  let hasLocalResources = false;
  if (localConnections && localConnections.length > 0) {
    localConnections.forEach((connection) => {
      if (!connection) {
        return;
      }
      // skip over any connection that doesn't have a Kafka cluster, which may have been previously
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

      // Only create Medusa if container is actually running
      let medusa: LocalMedusa | undefined;
      if (medusaUri) {
        medusa = LocalMedusa.create({
          uri: medusaUri,
        });
      }

      envs.push(
        new LocalEnvironment({
          id: connection.id as EnvironmentId,
          kafkaClusters,
          schemaRegistry,
          medusa,
        }),
      );

      hasLocalResources = true;
    });
  }

  // Handle case where only Medusa is running (no sidecar-managed resources)
  if (!hasLocalResources && medusaUri) {
    const medusa = LocalMedusa.create({
      uri: medusaUri,
    });
    envs.push(
      new LocalEnvironment({
        id: LOCAL_CONNECTION_ID as unknown as EnvironmentId,
        kafkaClusters: [],
        schemaRegistry: undefined,
        medusa,
      }),
    );
  }

  return envs;
}
