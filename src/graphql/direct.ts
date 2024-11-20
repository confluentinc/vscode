import { graphql } from "gql.tada";
import { Logger } from "../logging";
import { DirectEnvironment } from "../models/environment";
import { DirectKafkaCluster } from "../models/kafkaCluster";
import { DirectSchemaRegistry } from "../models/schemaRegistry";
import { getSidecar } from "../sidecar";

const logger = new Logger("graphql.local");

export async function getDirectResources(): Promise<DirectEnvironment[]> {
  let directResources: DirectEnvironment[] = [];

  const query = graphql(`
    query directConnections {
      directConnections {
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
      const directEnv = DirectEnvironment.create({
        connectionId: connection.id,
        id: connection.id,
        // FIXME: for some reason, the gql-tada introspection is saying `name` & `type` don't exist
        // for the connection object even though they're marked as required in the GraphQL schema
        name: (connection as any).name ?? "Direct Connection",
        connectionType: (connection as any).type ?? "DIRECT",
      });

      if (connection.kafkaCluster) {
        directEnv.kafkaCluster = DirectKafkaCluster.create({
          id: connection.kafkaCluster.id,
          name: "Kafka Cluster",
          bootstrapServers: connection.kafkaCluster.bootstrapServers,
          uri: connection.kafkaCluster.uri ?? "",
          connectionId: connection.id,
        });
      }

      if (connection.schemaRegistry) {
        directEnv.schemaRegistry = DirectSchemaRegistry.create({
          id: connection.schemaRegistry.id,
          uri: connection.schemaRegistry.uri,
          connectionId: connection.id,
        });
      }
      directResources.push(directEnv);
    });
  }
  return directResources;
}
