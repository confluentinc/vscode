import { graphql } from "gql.tada";
import { LOCAL_CONNECTION_ID } from "../constants";
import { ContextValues, setContextValue } from "../context";
import { Logger } from "../logging";
import { LocalKafkaCluster } from "../models/kafkaCluster";
import { getSidecar } from "../sidecar";
import { createLocalConnection, getLocalConnection } from "../sidecar/connections";

const logger = new Logger("graphql.local");

export async function getLocalKafkaClusters(): Promise<LocalKafkaCluster[]> {
  let localKafkaClusters: LocalKafkaCluster[] = [];

  // this is a bit odd, but we need to have a local "connection" to the sidecar before we can query
  // it for local Kafka clusters, so check if we have a connection first
  if (!(await getLocalConnection())) {
    try {
      await createLocalConnection();
    } catch {
      // error should be caught+logged in createLocalConnection
      // TODO: window.showErrorMessage here? might get noisy since this is triggered from refreshes
      return localKafkaClusters;
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
      }
    }
  `);

  const sidecar = await getSidecar();

  let response;
  try {
    response = await sidecar.query(query, LOCAL_CONNECTION_ID);
  } catch (error) {
    logger.error("Error fetching local connections", error);
    return localKafkaClusters;
  }

  const localConnections = response.localConnections;
  if (localConnections) {
    // filter out any connections that don't have a Kafka cluster, which may have been previously
    // created (but maybe the Kafka cluster isn't running anymore, etc.)
    const localConnectionsWithKafkaClusters = localConnections.filter(
      (connection) => connection !== null && connection.kafkaCluster !== null,
    );
    localKafkaClusters = localConnectionsWithKafkaClusters.map((connection) => {
      return LocalKafkaCluster.create({
        id: connection!.kafkaCluster!.id,
        name: connection!.kafkaCluster!.name,
        bootstrapServers: connection!.kafkaCluster!.bootstrapServers,
        uri: connection!.kafkaCluster!.uri,
      });
    });
  }
  // indicate to the UI that we have at least one local Kafka cluster available
  await setContextValue(ContextValues.localKafkaClusterAvailable, localKafkaClusters.length > 0);
  return localKafkaClusters;
}
