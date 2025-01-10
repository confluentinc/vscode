import { graphql } from "gql.tada";
import { Logger } from "../logging";
import { DirectEnvironment } from "../models/environment";
import { DirectKafkaCluster } from "../models/kafkaCluster";
import { ConnectionId } from "../models/resource";
import { DirectSchemaRegistry } from "../models/schemaRegistry";
import { getSidecar } from "../sidecar";
import {
  CustomConnectionSpec,
  DirectConnectionsById,
  getResourceManager,
} from "../storage/resourceManager";

const logger = new Logger("graphql.direct");

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

  let response;
  try {
    const sidecar = await getSidecar();
    response = await sidecar.query(query);
  } catch (error) {
    logger.error("Error fetching direct connection resources:", error);
    return directResources;
  }

  if (response.directConnections) {
    // look up the connectionId:spec map from storage
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
          environmentId: connection.id,
          ...connectionInfo,
        });
      }

      // combine the connection returned from GraphQL with the webview form augmented spec in storage
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
