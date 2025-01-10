import { authentication, AuthenticationSession, EventEmitter } from "vscode";
import { getSidecar } from ".";
import { ContainerListRequest, ContainerSummary, Port } from "../clients/docker";
import {
  Connection,
  ConnectionSpec,
  ConnectionsResourceApi,
  ConnectionType,
  ResponseError,
} from "../clients/sidecar";
import {
  AUTH_PROVIDER_ID,
  CCLOUD_CONNECTION_ID,
  CCLOUD_CONNECTION_SPEC,
  LOCAL_CONNECTION_ID,
  LOCAL_CONNECTION_SPEC,
} from "../constants";
import { ContextValues, getContextValue } from "../context/values";
import {
  getLocalSchemaRegistryImageName,
  getLocalSchemaRegistryImageTag,
  isDockerAvailable,
} from "../docker/configs";
import { MANAGED_CONTAINER_LABEL } from "../docker/constants";
import { getContainersForImage } from "../docker/containers";
import {
  connectionLoading,
  connectionStable,
  currentKafkaClusterChanged,
  currentSchemaRegistryChanged,
  environmentChanged,
} from "../emitters";
import { logResponseError } from "../errors";
import { Logger } from "../logging";
import { ConnectionId } from "../models/resource";
import { getResourceManager } from "../storage/resourceManager";
import { Message, MessageType } from "../ws/messageTypes";
import { isConnectionStable } from "./connectionStatusUtils";
import { WebsocketManager } from "./websocketManager";

const logger = new Logger("sidecar.connections");

/** Get the existing {@link Connection} (if it exists). */
export async function tryToGetConnection(id: string): Promise<Connection | null> {
  let connection: Connection | null = null;
  const sidecarHandle = await getSidecar();
  const client: ConnectionsResourceApi = sidecarHandle.getConnectionsResourceApi();
  try {
    connection = await client.gatewayV1ConnectionsIdGet({ id: id });
  } catch (error) {
    if (error instanceof ResponseError && error.response.status === 404) {
      logger.debug("No connection found", { connectionId: id });
    } else {
      // only log the non-404 errors, since we expect a 404 if the connection doesn't exist
      logResponseError(error, "fetching connection", { connectionId: id }, true);
    }
  }
  return connection;
}

/** Get the Confluent Cloud {@link Connection} (if it exists). */
export async function getCCloudConnection(): Promise<Connection | null> {
  return await tryToGetConnection(CCLOUD_CONNECTION_ID);
}

/** Get the local {@link Connection} (if it exists). */
export async function getLocalConnection(): Promise<Connection | null> {
  return await tryToGetConnection(LOCAL_CONNECTION_ID);
}

/** Create a new {@link Connection} with the given {@link ConnectionSpec}. */
export async function tryToCreateConnection(
  spec: ConnectionSpec,
  dryRun: boolean = false,
): Promise<Connection> {
  let connection: Connection;
  const client: ConnectionsResourceApi = (await getSidecar()).getConnectionsResourceApi();
  try {
    connection = await client.gatewayV1ConnectionsPost({
      dry_run: dryRun,
      ConnectionSpec: spec,
    });
    logger.debug(`${dryRun ? "tested" : "created"} new connection:`, {
      type: spec.type,
      id: connection.id,
    });
    return connection;
  } catch (error) {
    logResponseError(
      error,
      `${dryRun ? "testing" : "creating"} new connection:`,
      { connectionId: spec.id! },
      true,
    );
    throw error;
  }
}

/** Create the Confluent Cloud {@link Connection} and return it. */
export async function createCCloudConnection(): Promise<Connection> {
  return await tryToCreateConnection(CCLOUD_CONNECTION_SPEC);
}

/** Create the local {@link Connection} and return it. */
export async function createLocalConnection(): Promise<Connection> {
  return await tryToCreateConnection(LOCAL_CONNECTION_SPEC);
}

/** Delete the existing {@link Connection} with the given ID. */
export async function tryToDeleteConnection(id: string): Promise<void> {
  const client: ConnectionsResourceApi = (await getSidecar()).getConnectionsResourceApi();
  try {
    await client.gatewayV1ConnectionsIdDelete({ id: id });
    logger.debug("deleted connection:", { id });
  } catch (error) {
    if (error instanceof ResponseError && error.response.status === 404) {
      logger.debug("no connection found to delete:", { id });
      return;
    }
    logResponseError(error, "deleting connection", { connectionId: id }, true);
    throw error;
  }
}

/** Delete the existing Confluent Cloud {@link Connection} (if it exists). */
export async function deleteCCloudConnection(): Promise<void> {
  await tryToDeleteConnection(CCLOUD_CONNECTION_ID);
}

/** Delete the existing local {@link Connection} (if it exists). */
export async function deleteLocalConnection(): Promise<void> {
  await tryToDeleteConnection(LOCAL_CONNECTION_ID);
}

/** Update the existing {@link Connection} with the given {@link ConnectionSpec}. */
export async function tryToUpdateConnection(spec: ConnectionSpec): Promise<Connection> {
  // Forget any prior known cached connection state for this connection ID
  // so that any subsequent call to waitForConnectionToBeStable() will be based on post-update state.
  ConnectionStateWatcher.getInstance().purgeCachedConnectionState(spec.id! as ConnectionId);

  let connection: Connection;
  const client: ConnectionsResourceApi = (await getSidecar()).getConnectionsResourceApi();
  try {
    connection = await client.gatewayV1ConnectionsIdPut({
      id: spec.id!,
      ConnectionSpec: spec,
    });
    logger.debug("updated connection:", { id: connection.id });
    return connection;
  } catch (error) {
    logResponseError(error, "updating connection", { connectionId: spec.id! }, true);
    throw error;
  }
}

export async function clearCurrentCCloudResources() {
  // if the current connection changes or is deleted, we need to clear any associated CCloud resources
  // that may have depended on it:
  // - delete the extension state references to make sure they can't be used
  // - fire events to update things like the Topics view, Schemas view, etc.
  logger.warn("clearing current CCloud resources from extension state");
  await getResourceManager().deleteCCloudResources();
  currentKafkaClusterChanged.fire(null);
  currentSchemaRegistryChanged.fire(null);
}

/** Convenience function to check with the authentication API and get a CCloud auth session, if
 * one exists.
 *
 * NOTE: If any callers need to check for general CCloud connection status, they should do it here.
 * Any reactions to CCloud connection change should also use an event listener for the
 * `ccloudConnected` event emitter.
 *
 * @param createIfNone If `true`, create a new session if one doesn't exist. This starts the
 * browser-based sign-in flow to CCloud. (default: `false`)
 */
export async function getCCloudAuthSession(
  createIfNone: boolean = false,
): Promise<AuthenticationSession | undefined> {
  return await authentication.getSession(AUTH_PROVIDER_ID, [], { createIfNone: createIfNone });
}

/** Do we currently have a ccloud connection? */
export function hasCCloudAuthSession(): boolean {
  // Fastest way to check if the user is connected to Confluent Cloud, no round trips to sidecar. At extension startup
  // we set the initial context value to false, and any changes via ccloud auth provider will update this value.
  const isCcloudConnected: boolean | undefined = getContextValue(
    ContextValues.ccloudConnectionAvailable,
  );
  return !!isCcloudConnected;
}

/**
 * Discover any supported locally-running resources and update the local connection with the
 * relevant resource configs (for now, just Schema Registry containers, but in the future will
 * include Kafka and other resources).
 */
export async function updateLocalConnection(schemaRegistryUri?: string): Promise<void> {
  let spec: ConnectionSpec = LOCAL_CONNECTION_SPEC;

  // TODO(shoup): look up Kafka containers here once direct connections are used

  schemaRegistryUri = schemaRegistryUri ?? (await discoverSchemaRegistry());
  if (schemaRegistryUri) {
    spec = {
      ...LOCAL_CONNECTION_SPEC,
      local_config: {
        ...LOCAL_CONNECTION_SPEC.local_config,
        schema_registry_uri: schemaRegistryUri,
      },
    };
  }

  const currentLocalConnection: Connection | null = await getLocalConnection();
  // inform sidecar if the spec has changed (whether this is a new spec or if we're changing configs)
  if (!currentLocalConnection) {
    await tryToCreateConnection(spec);
  } else if (JSON.stringify(spec) !== JSON.stringify(currentLocalConnection?.spec)) {
    await tryToUpdateConnection(spec);
  }
}

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
  // We know this connection is in the process of being updated, so we can fire the loading event
  connectionLoading.fire(id);

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
    const msg = `waitForConnectionToBeStable(): connection ${id} did not become usable within ${timeoutMs}ms`;
    // reset any "loading" state for this connection
    connectionStable.fire(id);
    // and trigger any kind of Topics/Schemas refresh to reenforce the error state / clear out any
    // old data
    environmentChanged.fire(id);
    logger.error(msg);
    return null;
  }

  // per-type success actions ...
  const type = connection.spec.type!;
  if (type === ConnectionType.Direct) {
    // Fire when a direct connection is 'stable', be it happy or broken.
    connectionStable.fire(id);
    // notify subscribers that the "environment" has changed since direct connections are treated
    // as environment-specific resources
    environmentChanged.fire(id);
  }

  logger.debug(
    `waitForConnectionToBeStable(): connection is stable after ${Date.now() - startTime}ms, returning`,
  );

  return connection;
}

// TODO(shoup): this may need to move into a different file for general resource discovery
/** Discover any running Schema Registry containers and return the URI to include the REST proxy port. */
async function discoverSchemaRegistry(): Promise<string | undefined> {
  const dockerAvailable = await isDockerAvailable();
  if (!dockerAvailable) {
    return;
  }

  const imageRepo = getLocalSchemaRegistryImageName();
  const imageTag = getLocalSchemaRegistryImageTag();
  const repoTag = `${imageRepo}:${imageTag}`;
  const containerListRequest: ContainerListRequest = {
    all: true,
    filters: JSON.stringify({
      ancestor: [repoTag],
      label: [MANAGED_CONTAINER_LABEL],
      status: ["running"],
    }),
  };
  const containers: ContainerSummary[] = await getContainersForImage(containerListRequest);
  if (containers.length === 0) {
    return;
  }
  // we only care about the first container
  const container: ContainerSummary = containers.filter((c) => !!c.Ports)[0];
  const ports: Port[] = container.Ports?.filter((p) => !!p.PublicPort) || [];
  if (!ports || ports.length === 0) {
    logger.debug("No ports found on Schema Registry container", { container });
    return;
  }
  const schemaRegistryPort: Port | undefined = ports.find((p) => !!p.PublicPort);
  if (!schemaRegistryPort) {
    logger.debug("No PublicPort found on Schema Registry container", { container });
    return;
  }
  const restProxyPort = schemaRegistryPort.PublicPort;
  if (!restProxyPort) {
    logger.debug("No REST proxy port found on Schema Registry container", { container });
    return;
  }
  logger.debug("Discovered Schema Registry REST proxy port", { schemaRegistryPort });
  return `http://localhost:${restProxyPort}`;
}

/**
 * Definition for predicate functions passed into ConnectionStateWatcher.waitForConnectionUpdate() to determine
 * if a connection update should be considered for further processing. Allows for filtering out
 * updates that are not relevant to the caller w/o gaps where there could be 0 observers and therefore
 * missed updates.
 * */
export type ConnectionUpdatePredicate = (connection: Connection) => boolean;

/** Entry type kept in a per connection-id Map within ConnectionStateWatcher. */
class SingleConnectionState {
  mostRecentState: Connection | null = null;
  eventEmitter: EventEmitter<Connection> = new EventEmitter<Connection>();
}

export class ConnectionStateWatcher {
  // Singleton instance
  private static instance: ConnectionStateWatcher;

  // connection id -> pair of (most recent Connection announcement, event emitter to notify observers)
  private connectionStates: Map<ConnectionId, SingleConnectionState> = new Map();

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
      singleConnectionState.mostRecentState = null;
    }
  }

  /**
   * Get the most recent Connection description for the given connection ID.
   * Will return null if no CONNECTION_EVENT websocket messages have been
   * received for this connection, or if purgeCachedConnectionState() had been
   * called after the last update.
   */
  getLatestConnectionUpdate(connectionId: ConnectionId): Connection | null {
    const singleConnectionState = this.connectionStates.get(connectionId);
    return singleConnectionState?.mostRecentState || null;
  }

  /**
   * Wait at most `timeoutMs` for this connection to be updated with an Connection event from sidecar
   * that passes the given predicate. If the connection is already known to be in a predicate-passing state, this
   * will return immediately. If the connection is not in the desired state, this will wait for up to
   * the timeoutMs for the next update to arrive.
   * Resolves with the updated Connection or null if the timeout is reached.
   *
   * Callers who need to guarantee that they are working with the most recent Connection state should
   * first call purgeCachedConnectionState() *before* mutating the connection and then calling
   * this method.
   */
  async waitForConnectionUpdate(
    connectionId: ConnectionId,
    predicate: ConnectionUpdatePredicate,
    timeoutMs: number = 15_000,
  ): Promise<Connection | null> {
    let singleConnectionState = this.connectionStates.get(connectionId);
    if (!singleConnectionState) {
      // insert a new entry to track this connection
      singleConnectionState = new SingleConnectionState();
      this.connectionStates.set(connectionId, singleConnectionState);
    } else {
      // If we already know a connection state, test it against predicate and possibly
      // immediately return. (Otherwise wait for the next recieved update or timeout.)
      if (
        singleConnectionState.mostRecentState &&
        predicate(singleConnectionState.mostRecentState)
      ) {
        const connType = singleConnectionState.mostRecentState.spec.type!;
        logger.debug(
          `waitForConnectionUpdate(): Short-circuit returning existing connection state for ${connType} connection ${connectionId}`,
        );
        return singleConnectionState.mostRecentState;
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

      const dispose = singleConnectionState.eventEmitter.event((connection: Connection) => {
        const connType = connection.spec.type!;
        logger.debug(
          `ConnectionStateWatcher waitForConnectionUpdate(): Received connection update for ${connType} connection ${connectionId}`,
        );

        // Does it match the given predicate?
        if (predicate(connection)) {
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
      });
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
    const connection: Connection = connectionEvent.connection;

    logger.debug(
      `ConnectionStateWatcher: received ${message.body.action} event for connection id ${connectionId}`,
    );

    let singleConnectionState = this.connectionStates.get(connectionId);
    if (!singleConnectionState) {
      // insert a new entry to track this connection's updates.
      singleConnectionState = new SingleConnectionState();
      this.connectionStates.set(connectionId, singleConnectionState);
    }

    // Store this most recent Connection state / spec.
    singleConnectionState.mostRecentState = connection;
    // Fire the event emitter for this connection to alert any listeners about the update.
    singleConnectionState.eventEmitter.fire(connection);
  }
}
