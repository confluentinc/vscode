import { graphql } from "gql.tada";
import { Connection } from "../clients/sidecar/models";
import { logError, showErrorNotificationWithButtons } from "../errors";
import { DirectEnvironment } from "../models/environment";
import { DirectKafkaCluster } from "../models/kafkaCluster";
import { ConnectionId, EnvironmentId } from "../models/resource";
import { DirectSchemaRegistry } from "../models/schemaRegistry";
import { getSidecar } from "../sidecar";
import {
  CustomConnectionSpec,
  DirectConnectionsById,
  getResourceManager,
} from "../storage/resourceManager";

export async function getDirectResources(): Promise<DirectEnvironment[]> {
  let directResources: DirectEnvironment[] = [];

  const query = graphql(`
    query directConnections {
      directConnections {
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
  let response;
  try {
    response = await sidecar.query(query);
  } catch (error) {
    logError(error, "direct connection resources", {}, true);
    showErrorNotificationWithButtons(
      `Failed to fetch resources for direct Kafka / Schema Registry connection(s): ${error}`,
    );
    return directResources;
  }

  if (response.directConnections) {
    // Call connections api to learn the connection state of each connection, then filter
    // for direct connections so that we can assign to proper value to env.isLoading
    // Because for reasons the loading info is not in the GraphQL response.
    const connectionsApi = await sidecar.getConnectionsResourceApi();

    const connections = await connectionsApi.gatewayV1ConnectionsGet();

    // make a map of direct connection id -> connection state is loading or not.
    const connectionLoadingMap = new Map<string, boolean>();
    connections.data.forEach((connection: Connection) => {
      if (connection.spec.type === "DIRECT") {
        connectionLoadingMap.set(
          connection.id,
          connection.status.kafka_cluster?.state === "ATTEMPTING" ||
            connection.status.schema_registry?.state === "ATTEMPTING",
        );
      }
    });

    // Look up the connectionId:spec map from storage
    const directConnectionMap: DirectConnectionsById =
      await getResourceManager().getDirectConnections();

    response.directConnections.forEach((connection) => {
      if (!connection) {
        return;
      }

      const connectionInfo = {
        connectionId: connection.id as ConnectionId,
        connectionType: connection.type,
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

      // Combine the connection returned from GraphQL with the webview form augmented
      // spec in storage, which holds additional fields not known to the GraphQL API.
      const directSpec: CustomConnectionSpec | undefined = directConnectionMap.get(
        connection.id as ConnectionId,
      );

      const directEnv = new DirectEnvironment({
        id: connection.id,
        name: connection.name,
        kafkaClusters: kafkaCluster ? [kafkaCluster] : [],
        kafkaConfigured: !!directSpec?.kafka_cluster,
        schemaRegistry,
        schemaRegistryConfigured: !!directSpec?.schema_registry,
        formConnectionType: directSpec?.formConnectionType,
        isLoading: connectionLoadingMap.get(connection.id) ?? true,
        ...connectionInfo,
      });
      directResources.push(directEnv);
    });
  }

  // sort multiple environments by name
  if (directResources.length > 1) {
    directResources.sort((a, b) => a.name.localeCompare(b.name));
  }

  return directResources;
}
