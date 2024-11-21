import { graphql } from "gql.tada";
import { Logger } from "../logging";
import { DirectEnvironment } from "../models/environment";
import { DirectKafkaCluster } from "../models/kafkaCluster";
import { ConnectionId } from "../models/resource";
import { DirectSchemaRegistry } from "../models/schemaRegistry";
import { getSidecar } from "../sidecar";

const logger = new Logger("graphql.local");

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
    response.directConnections.forEach((connection) => {
      if (!connection) {
        return;
      }

      let kafkaCluster: DirectKafkaCluster | undefined;
      if (connection.kafkaCluster) {
        kafkaCluster = DirectKafkaCluster.create({
          id: connection.kafkaCluster.id,
          name: "Kafka Cluster",
          bootstrapServers: connection.kafkaCluster.bootstrapServers,
          uri: connection.kafkaCluster.uri ?? "",
          connectionId: connection.id as ConnectionId,
        });
      }

      let schemaRegistry: DirectSchemaRegistry | undefined;
      if (connection.schemaRegistry) {
        schemaRegistry = DirectSchemaRegistry.create({
          id: connection.schemaRegistry.id,
          uri: connection.schemaRegistry.uri,
          connectionId: connection.id as ConnectionId,
          environmentId: connection.id,
        });
      }

      const directEnv = DirectEnvironment.create({
        connectionId: connection.id as ConnectionId,
        id: connection.id,
        name: connection.name,
        kafkaClusters: kafkaCluster ? [kafkaCluster] : [],
        schemaRegistry,
      });
      directResources.push(directEnv);
    });
  }
  return directResources;
}
