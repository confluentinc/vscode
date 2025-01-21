import { commands, EventEmitter } from "vscode";
import { Connection, ConnectionType } from "../../clients/sidecar";
import { connectionStable, environmentChanged } from "../../emitters";
import { showErrorNotificationWithButtons } from "../../errors";
import { Logger } from "../../logging";
import { ConnectionId, connectionIdToType, EnvironmentId } from "../../models/resource";
import { ConnectionEventBody, Message, MessageType } from "../../ws/messageTypes";
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
    environmentChanged.fire(id as unknown as EnvironmentId);
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
  notifyForFailedState(connection);

  return connection;
}

function notifyForFailedState(connection: Connection) {
  let failedStatuses: string[] = [];
  // the notifications don't allow rich formatting here, so we'll just list out the failed resources
  // and then try to show the errors themselves in the item tooltips
  if (connection.status.ccloud?.state === "FAILED") failedStatuses.push("Confluent Cloud");
  if (connection.status.kafka_cluster?.state === "FAILED") failedStatuses.push("Kafka");
  if (connection.status.schema_registry?.state === "FAILED") failedStatuses.push("Schema Registry");
  if (failedStatuses.length > 0) {
    showErrorNotificationWithButtons(
      `Failed to establish connection to ${failedStatuses.join(" and ")} for "${connection.spec.name}".`,
      {
        "View Connection Details": () =>
          commands.executeCommand(`confluent.connections.direct.edit`, connection.id),
      },
    );
  }
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
   * Callers who need to guarantee that they are working with a Connection state recieved AFTER
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
      // immediately return. (Otherwise wait for the next recieved update or timeout.)
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
    singleConnectionState.handleUpdate(message.body);
  }
}
