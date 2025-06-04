import { graphql } from "gql.tada";
import { commands } from "vscode";
import { ConnectedState, Connection, ConnectionStatus, ConnectionType } from "../clients/sidecar";
import { logError } from "../errors";
import { Logger } from "../logging";
import { DirectEnvironment } from "../models/environment";
import { DirectKafkaCluster } from "../models/kafkaCluster";
import { ConnectionId, EnvironmentId } from "../models/resource";
import { DirectSchemaRegistry } from "../models/schemaRegistry";
import {
  DEFAULT_ERROR_NOTIFICATION_BUTTONS,
  showErrorNotificationWithButtons,
  showWarningNotificationWithButtons,
} from "../notifications";
import { getSidecar } from "../sidecar";
import { ConnectionStateWatcher } from "../sidecar/connections/watcher";
import { CustomConnectionSpec, getResourceManager } from "../storage/resourceManager";
import { logUsage, UserEvent } from "../telemetry/events";
import { ConnectionEventBody } from "../ws/messageTypes";

const logger = new Logger("graphql.direct");

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

  // make sure the connection is in a stable (SUCCESS/FAILED) state, because if it's still ATTEMPTING,
  // we run into weird race conditions where the GraphQL result may be missing child resources when
  // the websocket event fires, and the ResourceViewProvider can't reconcile those
  const watcher = ConnectionStateWatcher.getInstance();
  const latestStatus: ConnectionStatus | undefined =
    watcher.getLatestConnectionEvent(connectionId)?.connection.status;
  if (
    latestStatus?.kafka_cluster?.state === ConnectedState.Attempting ||
    latestStatus?.schema_registry?.state === ConnectedState.Attempting
  ) {
    logger.debug("waiting for direct connection to be in a stable state before submitting query", {
      connectionId,
      kafkaClusterState: latestStatus?.kafka_cluster?.state,
      schemaRegistryState: latestStatus?.schema_registry?.state,
    });
    const connection: Connection | null = await watcher.waitForConnectionUpdate(
      connectionId,
      (event: ConnectionEventBody) => {
        // block until we see a websocket event that indicates the connection is no longer ATTEMPTING
        // for either Kafka or Schema Registry, based on the configuration
        // (so whether it's SUCCESS or FAILED, we can move on with the GraphQL query and know the
        // connection isn't in a transient state)
        const status = event.connection.status;
        return (
          status.kafka_cluster?.state !== ConnectedState.Attempting &&
          status.schema_registry?.state !== ConnectedState.Attempting
        );
        // use default 15sec timeout
      },
    );
    if (!connection) {
      logger.warn("timed out waiting for direct connection to stabilize before submitting query", {
        connectionId,
      });
      // we timed out waiting for the connection to stabilize, so the query will not return any
      // Kafka/Schema Registry resources and will appear broken
      const spec: CustomConnectionSpec | null =
        await getResourceManager().getDirectConnection(connectionId);
      showWarningNotificationWithButtons(
        `Unable to fetch resources for connection "${spec?.name}": timed out waiting for connection to stabilize.`,
        {
          "View Connection Details": () =>
            commands.executeCommand("confluent.connections.direct.edit", connectionId),
          ...DEFAULT_ERROR_NOTIFICATION_BUTTONS,
        },
      );
      // log telemetry for this case, so we can see how often it happens
      logUsage(UserEvent.DirectConnectionAction, {
        action: "timed out waiting for connection to stabilize before GraphQL query",
        type: spec?.formConnectionType,
        specifiedConnectionType: spec?.specifiedConnectionType,
        withKafka: !!spec?.kafka_cluster,
        withSchemaRegistry: !!spec?.schema_registry,
        failedReason: "connection still in ATTEMPTING state",
      });
    }
  }

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
      return;
    }

    logError(error, "direct connection resources", {
      extra: { functionName: "getDirectResources" },
    });
    showErrorNotificationWithButtons(
      `Failed to fetch resources for direct Kafka / Schema Registry connection(s): ${error}`,
    );

    // Treat as if the connection does not exist. If the unexpected GQL error is transient,
    // the user can refresh the resources view to retry.
    return;
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

  logger.debug("returning direct environment", {
    connectionId,
    connectionName: connection.name,
    hasKafkaCluster: !!kafkaCluster,
    hasSchemaRegistry: !!schemaRegistry,
  });
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
