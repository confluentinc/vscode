import { commands, EventEmitter } from "vscode";
import {
  CCloudStatus,
  ConnectedState,
  Connection,
  ConnectionSpec,
  ConnectionType,
  KafkaClusterConfig,
  SchemaRegistryConfig,
} from "../../clients/sidecar";
import { getCredentialsType } from "../../directConnections/credentials";
import { FormConnectionType, SupportedAuthTypes } from "../../directConnections/types";
import { connectionStable, environmentChanged } from "../../emitters";
import { showErrorNotificationWithButtons } from "../../errors";
import { Logger } from "../../logging";
import { ConnectionId, connectionIdToType, EnvironmentId } from "../../models/resource";
import { CustomConnectionSpec, getResourceManager } from "../../storage/resourceManager";
import { logUsage, UserEvent } from "../../telemetry/events";
import {
  ConnectionEventAction,
  ConnectionEventBody,
  Message,
  MessageType,
} from "../../ws/messageTypes";
import { WebsocketManager } from "../websocketManager";
import { connectionEventHandler, isConnectionStable } from "./watcherUtils";

const logger = new Logger("sidecar.connections.watcher");

/**
 * Wait up to timeoutMs for a new connection with the given ID to be stable
 * (either fully connected and happy, or definitely broken), to be done before any GraphQL or proxied
 * client queries.
 *
 * For `CCLOUD` connections, this will wait for the CCloud state to be anything other than `NONE` or `ATTEMPTING`.
 *
 * For `DIRECT` connections, this will wait for Kafka and Schema Registry states to be anything other
 * than `ATTEMPTING`.
 */
export async function waitForConnectionToBeStable(
  id: ConnectionId,
  timeoutMs: number = 15_000,
): Promise<Connection | null> {
  const startTime = Date.now();

  logger.debug(
    `waitForConnectionToBeStable(): Calling ConnectionStateWatcher.waitForConnectionUpdate() for ${id} to wait for it to become stable soon.`,
  );
  const connectionStateWatcher = ConnectionStateWatcher.getInstance();
  const connection = await connectionStateWatcher.waitForConnectionUpdate(
    id,
    isConnectionStable,
    timeoutMs,
  );
  if (!connection) {
    const msg = `waitForConnectionToBeStable(): connection ${id} did not become stable within ${timeoutMs}ms`;
    // reset any "loading" state for this connection
    connectionStable.fire(id);
    // and trigger any kind of Topics/Schemas refresh to reenforce the error state / clear out any
    // old data
    environmentChanged.fire({ id: id as unknown as EnvironmentId, wasDeleted: false });
    const lastConnectionEvent = connectionStateWatcher.getLatestConnectionEvent(id);
    if (lastConnectionEvent) {
      showErrorNotificationWithButtons(
        `Timed out establishing "${lastConnectionEvent.connection.spec.name}" connection.`,
      );
    }
    logger.error(msg);
    return null;
  }

  logger.debug(
    `waitForConnectionToBeStable(): connection is stable after ${Date.now() - startTime}ms, returning`,
  );
  await reportUsableState(connection);

  return connection;
}

/**
 * Show an error notification to the user if a {@linkcode Connection} has a `FAILED` status.
 *
 * For `DIRECT` connections, this will show a notification if the Kafka Cluster or Schema Registry
 * status is `FAILED` and provide a button to view/edit the connection via webview form.
 *
 * For `CCLOUD` connections, this will show a notification if the Confluent Cloud status is `FAILED`
 * and provide buttons to open the logs or file an issue.
 */
export async function reportUsableState(connection: Connection) {
  const [successfulConnectionSummaries, failedConnectionSummaries]: [
    ConnectionSummary[],
    ConnectionSummary[],
  ] = await Promise.all([
    getConnectionSummaries(connection, ConnectedState.Success),
    getConnectionSummaries(connection, ConnectedState.Failed),
  ]);

  if (failedConnectionSummaries.length > 0) {
    let notificationButtons: Record<string, () => void> | undefined;
    // only show the "View Connection Details" button if there were failed states for any of the
    // configs from a direct connection (Kafka or Schema Registry)
    const failedDirectSummaries = failedConnectionSummaries.some(
      ({ connectionType }) => connectionType === ConnectionType.Direct,
    );
    if (failedDirectSummaries) {
      notificationButtons = {
        "View Connection Details": () =>
          commands.executeCommand("confluent.connections.direct.edit", connection.id),
      };
    }
    const failedTypes: ConfigType[] = failedConnectionSummaries.map((state) => state.configType);
    // the notifications don't allow rich formatting here, so we'll just list out the failed resources
    // and then try to show the errors themselves in the item tooltips if possible
    showErrorNotificationWithButtons(
      `Failed to establish connection to ${failedTypes.join(" and ")} for "${connection.spec.name}".`,
      notificationButtons,
    );
  }

  // send an event for direct connections to help understand how often SUCCESS/FAILED happens,
  // for which configs, etc.
  if (connection.spec.type === ConnectionType.Direct) {
    failedConnectionSummaries.forEach((state) => {
      const configPrefix = state.configType === "Kafka" ? "kafka" : "schemaRegistry";
      logUsage(UserEvent.DirectConnectionAction, {
        action: "failed to connect",
        type: state.type, // formConnectionType
        specifiedConnectionType: state.specifiedConnectionType,
        // withKafka or withSchemaRegistry
        [`with${state.configType.replace(" ", "")}`]: true,
        configType: state.configType,
        // kafkaAuthType or schemaRegistryAuthType
        [`${configPrefix}AuthType`]: state.authType,
        // kafkaConfigSslEnabled or schemaRegistryConfigSslEnabled
        [`${configPrefix}SslEnabled`]: state.sslEnabled,
      });
    });
    successfulConnectionSummaries.forEach((state) => {
      const configPrefix = state.configType === "Kafka" ? "kafka" : "schemaRegistry";
      logUsage(UserEvent.DirectConnectionAction, {
        action: "successfully connected",
        type: state.type,
        specifiedConnectionType: state.specifiedConnectionType,
        // withKafka or withSchemaRegistry
        [`with${state.configType.replace(" ", "")}`]: true,
        configType: state.configType,
        // kafkaAuthType or schemaRegistryAuthType
        [`${configPrefix}AuthType`]: state.authType,
        // kafkaConfigSslEnabled or schemaRegistryConfigSslEnabled
        [`${configPrefix}SslEnabled`]: state.sslEnabled,
      });
    });
  }
}

/**
 * The type of configuration used in the {@link ConnectionSpec}.
 * - `Kafka` for a {@link KafkaClusterConfig}
 * - `Schema Registry` for a {@link SchemaRegistryConfig}
 * - `Confluent Cloud` for a {@link CCloudConfig}
 */
type ConfigType = "Kafka" | "Schema Registry" | "Confluent Cloud";

/** Summary of a {@link Connection}'s {@link ConnectedState} and config, including additional fields
 * that may not be tracked by the sidecar (mainly for `DIRECT` connections). */
export interface ConnectionSummary {
  connectionType: ConnectionType;
  configType: ConfigType;
  connectedState: ConnectedState;
  type?: FormConnectionType;
  specifiedConnectionType?: string; // "Other" form connection type's user-entered string
  authType?: SupportedAuthTypes | "Browser";
  sslEnabled?: boolean;
}

/**
 * Return an array of {@link ConnectionSummary} for the given {@link Connection}'s config state(s)
 * that match the provided {@linkcode ConnectedState state}.
 */
export async function getConnectionSummaries(
  connection: Connection,
  state: ConnectedState,
): Promise<ConnectionSummary[]> {
  const states: ConnectionSummary[] = [];

  const spec: ConnectionSpec = connection.spec;
  const type: ConnectionType = spec.type!;
  switch (type) {
    case ConnectionType.Direct:
      {
        // look up the stored spec to get additional properties not tracked by the sidecar
        const formSpec: CustomConnectionSpec | null =
          await getResourceManager().getDirectConnection(connection.id as ConnectionId);

        const kafkaClusterState: ConnectedState | undefined =
          connection.status.kafka_cluster?.state;
        if (kafkaClusterState === state) {
          const kafkaConfig: KafkaClusterConfig | undefined = connection.spec.kafka_cluster;
          states.push({
            connectionType: ConnectionType.Direct,
            type: formSpec?.formConnectionType,
            specifiedConnectionType: formSpec?.specifiedConnectionType,
            configType: "Kafka",
            authType: getCredentialsType(kafkaConfig?.credentials),
            sslEnabled: kafkaConfig?.ssl?.enabled ?? false,
            connectedState: state,
          });
        }

        const schemaRegistryState: ConnectedState | undefined =
          connection.status.schema_registry?.state;
        if (schemaRegistryState === state) {
          const schemaRegistryConfig: SchemaRegistryConfig | undefined =
            connection.spec.schema_registry;
          states.push({
            connectionType: ConnectionType.Direct,
            type: formSpec?.formConnectionType,
            specifiedConnectionType: formSpec?.specifiedConnectionType,
            configType: "Schema Registry",
            authType: getCredentialsType(schemaRegistryConfig?.credentials),
            sslEnabled: schemaRegistryConfig?.ssl?.enabled ?? false,
            connectedState: state,
          });
        }
      }
      break;
    case ConnectionType.Ccloud: {
      const ccloudStatus: CCloudStatus | undefined = connection.status.ccloud;
      if (ccloudStatus && ccloudStatus.state === state) {
        states.push({
          connectionType: ConnectionType.Ccloud,
          configType: "Confluent Cloud",
          authType: "Browser",
          connectedState: state,
        });
      }
    }
  }

  return states;
}

/**
 * Definition for predicate functions passed into ConnectionStateWatcher.waitForConnectionUpdate() to determine
 * if a connection update should be considered for further processing. Allows for filtering out
 * updates that are not relevant to the caller w/o gaps where there could be 0 observers and therefore
 * missed updates.
 * */
export type ConnectionUpdatePredicate = (event: ConnectionEventBody) => boolean;

/** Entry type kept in a per connection-id Map within ConnectionStateWatcher. */
export class SingleConnectionEntry {
  connectionId: ConnectionId;
  mostRecentEvent: ConnectionEventBody | null = null;
  eventEmitter: EventEmitter<ConnectionEventBody> = new EventEmitter<ConnectionEventBody>();

  constructor(connectionId: ConnectionId) {
    this.connectionId = connectionId;

    // Wire up the default event listener per connection type that will react to any
    // connection state changes and cascade through to fire the appropriate UI event emitters.
    // based on the connection type and new state.
    this.eventEmitter.event((event: ConnectionEventBody) => {
      connectionEventHandler(event);
    });
  }

  get connectionType(): ConnectionType {
    return connectionIdToType(this.connectionId);
  }

  get connection(): Connection | null {
    return this.mostRecentEvent?.connection || null;
  }

  /** Update the most recent Connection-bearing announcement and fire the event emitter. */
  handleUpdate(event: ConnectionEventBody): void {
    // If the connection id != our connection id, raise an error.
    if (event.connection.id !== this.connectionId) {
      throw new Error(
        `SingleConnectionEntry.handleUpdate(): received event for connection ${event.connection.id} but expected ${this.connectionId}`,
        // JSON.stringify(event, null, 2),
      );
    }

    // New info. Update the most recent event and fire the event emitter.
    this.mostRecentEvent = event;
    this.eventEmitter.fire(event);
  }
}

export class ConnectionStateWatcher {
  // Singleton instance
  private static instance: ConnectionStateWatcher;

  // connection id -> pair of (most recent Connection-bearing announcement, event emitter to notify observers)
  private connectionStates: Map<ConnectionId, SingleConnectionEntry> = new Map();

  public static getInstance(): ConnectionStateWatcher {
    if (!ConnectionStateWatcher.instance) {
      ConnectionStateWatcher.instance = new ConnectionStateWatcher();
    }
    return ConnectionStateWatcher.instance;
  }

  private constructor() {
    // Register handleConnectionUpdateEvent as a listener for CONNECTION_EVENT websocket messages
    WebsocketManager.getInstance().subscribe(
      MessageType.CONNECTION_EVENT,
      this.handleConnectionUpdateEvent.bind(this),
    );
  }

  /**
   * Forget any prior state for the given connection ID by resetting any map
   * entry's mostRecentState to null. Needed when, say, a direct connection has
   * been updated and we want to guarantee to wait for the next update to be
   * sure it's stable.
   */
  purgeCachedConnectionState(connectionId: ConnectionId): void {
    const singleConnectionState = this.connectionStates.get(connectionId);
    if (singleConnectionState) {
      singleConnectionState.mostRecentEvent = null;
    }
  }

  /**
   * Get the most recent Connection description for the given connection ID.
   * Will return null if no CONNECTION_EVENT websocket messages have been
   * received for this connection, or if purgeCachedConnectionState() had been
   * called after the last update.
   */
  getLatestConnectionEvent(connectionId: ConnectionId): ConnectionEventBody | null {
    const singleConnectionState = this.connectionStates.get(connectionId);
    return singleConnectionState?.mostRecentEvent || null;
  }

  /**
   * Wait at most `timeoutMs` for this connection to be updated with an Connection event from sidecar
   * that passes the given predicate. If the connection is already known to be in a predicate-passing state, this
   * will return immediately. If the connection is not in the desired state, this will wait for up to
   * the timeoutMs for the next update to arrive.
   * Resolves with the updated Connection or null if the timeout is reached.
   *
   * Callers who need to guarantee that they are working with a Connection state received AFTER
   * a point in time should first call purgeCachedConnectionState() *before* mutating
   * the connection and then calling this method. There is an unavoidable inherent race, however.
   */
  async waitForConnectionUpdate(
    connectionId: ConnectionId,
    predicate: ConnectionUpdatePredicate,
    timeoutMs: number = 15_000,
  ): Promise<Connection | null> {
    let singleConnectionEntry = this.connectionStates.get(connectionId);
    if (!singleConnectionEntry) {
      // insert a new entry to track this connection
      singleConnectionEntry = new SingleConnectionEntry(connectionId);
      this.connectionStates.set(connectionId, singleConnectionEntry);
    } else {
      // If we already know a connection state, test it against predicate and possibly
      // immediately return. (Otherwise wait for the next received update or timeout.)
      if (
        singleConnectionEntry.mostRecentEvent &&
        predicate(singleConnectionEntry.mostRecentEvent)
      ) {
        const connType = singleConnectionEntry.connectionType;
        logger.debug(
          `waitForConnectionUpdate(): Short-circuit returning existing connection state for ${connType} connection ${connectionId}`,
        );
        return singleConnectionEntry.connection!;
      }
    }

    return new Promise((resolve) => {
      // Implicitly race between the timeout and a temporary event listener over a predicate-passing update
      // to the desired connection.
      const timeout = setTimeout(() => {
        // Did not get an update within the timeout.
        logger.warn(
          `ConnectionStateWatcher waitForConnectionUpdate(): Timed out waiting for connection update for connection ${connectionId}`,
        );
        // Cancel the temporary event listner
        dispose.dispose();
        // ... and resolve to the caller indicating the timeout fired.
        resolve(null);
      }, timeoutMs);

      const dispose = singleConnectionEntry.eventEmitter.event(
        (connectionEvent: ConnectionEventBody) => {
          const connection = connectionEvent.connection;
          const connType = connection.spec.type!;
          logger.debug(
            `ConnectionStateWatcher waitForConnectionUpdate(): Received connection update for ${connType} connection ${connectionId}`,
          );

          // Does it match the given predicate?
          if (predicate(connectionEvent)) {
            logger.debug(
              "ConnectionStateWatcher waitForConnectionUpdate(): passed predicate, resolving",
            );
            // Cancel the timeout,
            clearTimeout(timeout);
            // deregister this listener,
            dispose.dispose();
            // resolve the predicate-passing Connection to the caller.
            resolve(connection);
          } else {
            logger.debug(
              "ConnectionStateWatcher waitForConnectionUpdate(): did not pass predicate, waiting for next update",
            );
            // leave the listener registered for the next update (or until the timeout fires)
          }
        },
      );
    });
  }

  /**
   * Handle connection state change events from sidecar websocket pushed messages.
   * Stashes the new connection state into our map cache for safe keeping,
   * and fires the event emitter for the single connection.
   */
  async handleConnectionUpdateEvent(message: Message<MessageType.CONNECTION_EVENT>): Promise<void> {
    const connectionEvent = message.body;
    const connectionId = connectionEvent.connection.id as ConnectionId;

    logger.debug(
      `ConnectionStateWatcher: received ${message.body.action} event for connection id ${connectionId}`,
    );

    let singleConnectionState = this.connectionStates.get(connectionId);
    if (!singleConnectionState) {
      // Insert a new entry to track this connection's updates.
      singleConnectionState = new SingleConnectionEntry(connectionId);
      this.connectionStates.set(connectionId, singleConnectionState);
    }

    // Store this most recent Connection state / spec, fire off to event handlers observing
    // this single connection.
    singleConnectionState.handleUpdate(connectionEvent);
  }

  /**
   * Cache a connection if it's not already known to the ConnectionStateWatcher, primarily in the
   * case where a {@link Connection} is known (e.g. from the Connections API) and we haven't yet
   * received any websocket events.
   */
  cacheConnectionIfNeeded(connection: Connection): void {
    const connectionId = connection.id as ConnectionId;
    let singleConnectionState = this.connectionStates.get(connectionId);
    if (singleConnectionState) {
      logger.debug("connection already known, not caching", { connectionId });
      return;
    }
    logger.debug("caching connection", { connectionId });
    // Insert a new entry to track this connection's updates.
    singleConnectionState = new SingleConnectionEntry(connectionId);
    this.connectionStates.set(connectionId, singleConnectionState);
    // Store this most recent Connection state / spec, fire off to event handlers observing
    // this single connection.
    singleConnectionState.handleUpdate({
      action: ConnectionEventAction.UPDATED, // seems the least-toxic guess
      connection,
    });
  }
}
