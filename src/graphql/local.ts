import { graphql } from "gql.tada";
import { LOCAL_CONNECTION_ID } from "../constants";
import { Logger } from "../logging";
import { LocalKafkaCluster } from "../models/kafkaCluster";
import { LocalSchemaRegistry } from "../models/schemaRegistry";
import { getSidecar, SidecarHandle } from "../sidecar";
import { createLocalConnection, getLocalConnection } from "../sidecar/connections";

const logger = new Logger("graphql.local");

export interface LocalResourceGroup {
  kafkaClusters: LocalKafkaCluster[];
  schemaRegistry?: LocalSchemaRegistry;
  // TODO: Add Flink compute pool as cluster type eventually
}

export async function getLocalResources(
  sidecar: SidecarHandle | undefined = undefined,
): Promise<LocalResourceGroup[]> {
  if (!sidecar) {
    sidecar = await getSidecar();
  }

  let localResources: LocalResourceGroup[] = [];

  // this is a bit odd, but we need to have a local "connection" to the sidecar before we can query
  // it for local Kafka clusters, so check if we have a connection first
  if (!(await getLocalConnection())) {
    try {
      await createLocalConnection();
    } catch {
      // error should be caught+logged in createLocalConnection
      // TODO: window.showErrorMessage here? might get noisy since this is triggered from refreshes
      return localResources;
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

  let response;
  try {
    response = await sidecar.query(query, LOCAL_CONNECTION_ID);
  } catch (error) {
    logger.error("Error fetching local connections", error);
    return localResources;
  }

  const localConnections = response.localConnections;
  if (localConnections) {
    // filter out any connections that don't have a Kafka cluster, which may have been previously
    // created (but maybe the Kafka cluster isn't running anymore, etc.)
    const localConnectionsWithKafkaClusters = localConnections.filter(
      (connection) => connection !== null && connection.kafkaCluster !== null,
    );
    localConnectionsWithKafkaClusters.forEach((connection) => {
      const kafkaCluster: LocalKafkaCluster = LocalKafkaCluster.create({
        id: connection!.kafkaCluster!.id,
        name: connection!.kafkaCluster!.name,
        bootstrapServers: connection!.kafkaCluster!.bootstrapServers,
        uri: connection!.kafkaCluster!.uri,
      });
      const schemaRegistry: LocalSchemaRegistry | undefined = connection!.schemaRegistry
        ? LocalSchemaRegistry.create({
            id: connection!.schemaRegistry.id,
            uri: connection!.schemaRegistry.uri,
          })
        : undefined;
      localResources.push({
        kafkaClusters: [kafkaCluster],
        schemaRegistry: schemaRegistry,
      });
    });
  }
  return localResources;
}
