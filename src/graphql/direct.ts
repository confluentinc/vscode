import { graphql } from "gql.tada";
import { ConnectionType } from "../clients/sidecar";
import { logError } from "../errors";
import { DirectEnvironment } from "../models/environment";
import { DirectKafkaCluster } from "../models/kafkaCluster";
import { ConnectionId, EnvironmentId } from "../models/resource";
import { DirectSchemaRegistry } from "../models/schemaRegistry";
import { showErrorNotificationWithButtons } from "../notifications";
import { getSidecar } from "../sidecar";
import { CustomConnectionSpec, getResourceManager } from "../storage/resourceManager";

export async function getDirectResources(
  connectionId: ConnectionId,
): Promise<DirectEnvironment | undefined> {
  const query = graphql(`
    query directConnection($id: String!) {
      directConnectionById(connectionID: $id) {
        id
        name
        type
        kafkaCluster {
          id
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
  let response: { directConnectionById: any | null };
  try {
    response = await sidecar.query(query, connectionId, { id: connectionId });
  } catch (error) {
    if (error instanceof Error && /non null type/.test(error.message)) {
      // connection was not found, query returned null against the schema
      // Treat as if the connection does not exist. When sidecar GQL spec is updated to
      // describe ability to return null instead of throwing, this will no longer be needed,
      // https://github.com/confluentinc/ide-sidecar/issues/447

      // When a connection is deleted, the chain of events firing somewhat unfortunately
      // loses some context and we end up re-querying the connection by ID.
      return undefined;
    }

    logError(error, "direct connection resources", {
      extra: { functionName: "getDirectResources" },
    });
    showErrorNotificationWithButtons(
      `Failed to fetch resources for direct Kafka / Schema Registry connection(s): ${error}`,
    );

    // Treat as if the connection does not exist. If the unexpected GQL error is transient,
    // the user can refresh the resources view to retry.
    return undefined;
  }

  const connection = response.directConnectionById;
  if (!connection) {
    return;
  }

  const connectionInfo = {
    connectionId: connection.id as ConnectionId,
    connectionType: ConnectionType.Direct,
  };

  let kafkaCluster: DirectKafkaCluster | undefined;
  if (connection.kafkaCluster) {
    kafkaCluster = DirectKafkaCluster.create({
      id: connection.kafkaCluster.id,
      name: "Kafka Cluster",
      bootstrapServers: connection.kafkaCluster.bootstrapServers,
      uri: connection.kafkaCluster.uri ?? "",
      ...connectionInfo,
    });
  }

  let schemaRegistry: DirectSchemaRegistry | undefined;
  if (connection.schemaRegistry) {
    schemaRegistry = DirectSchemaRegistry.create({
      id: connection.schemaRegistry.id,
      uri: connection.schemaRegistry.uri,
      environmentId: connection.id as EnvironmentId,
      ...connectionInfo,
    });
  }

  // look up the connectionId:spec map from storage
  const directSpec: CustomConnectionSpec | null =
    await getResourceManager().getDirectConnection(connectionId);

  const env = new DirectEnvironment({
    id: connection.id as EnvironmentId,
    name: connection.name,
    kafkaClusters: kafkaCluster ? [kafkaCluster] : [],
    kafkaConfigured: !!directSpec?.kafka_cluster,
    schemaRegistry,
    schemaRegistryConfigured: !!directSpec?.schema_registry,
    formConnectionType: directSpec?.formConnectionType,
    ...connectionInfo,
  });
  return env;
}
