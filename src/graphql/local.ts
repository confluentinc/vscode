import { graphql } from "gql.tada";
import { commands } from "vscode";
import { Connection, ConnectionsResourceApi } from "../clients/sidecar";
import { LOCAL_CONNECTION_ID, LOCAL_CONNECTION_SPEC } from "../constants";
import { LocalKafkaCluster } from "../models/kafkaCluster";
import { getSidecar } from "../sidecar";

export async function getLocalKafkaClusters(): Promise<LocalKafkaCluster[]> {
  let localKafkaClusters: LocalKafkaCluster[] = [];

  // this is a bit odd, but we need to have a local "connection" to the sidecar before we can query
  // it for local Kafka clusters, so check if we have a connection first
  await ensureLocalConnection();

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
    console.error("Error fetching local connections", error);
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
  await commands.executeCommand(
    "setContext",
    "confluent.localKafkaClusterAvailable",
    localKafkaClusters.length > 0,
  );
  return localKafkaClusters;
}

async function ensureLocalConnection(): Promise<void> {
  const client: ConnectionsResourceApi = (await getSidecar()).getConnectionsResourceApi();

  let localConnection: Connection | null = null;
  try {
    localConnection = await client.gatewayV1ConnectionsIdGet({
      id: LOCAL_CONNECTION_ID,
    });
  } catch (e) {
    console.error("Error getting existing local connection", e);
  }

  if (!localConnection) {
    await client.gatewayV1ConnectionsPost({
      ConnectionSpec: LOCAL_CONNECTION_SPEC,
    });
  }
  return;
}
