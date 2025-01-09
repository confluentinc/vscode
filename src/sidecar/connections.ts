import { authentication, AuthenticationSession, EventEmitter } from "vscode";
import { getSidecar } from ".";
import { ContainerListRequest, ContainerSummary, Port } from "../clients/docker";
import {
  ConnectedState,
  Connection,
  ConnectionSpec,
  ConnectionsResourceApi,
  ConnectionStatus,
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
  connectionUsable,
  currentKafkaClusterChanged,
  currentSchemaRegistryChanged,
  environmentChanged,
} from "../emitters";
import { logResponseError } from "../errors";
import { Logger } from "../logging";
import { ConnectionId } from "../models/resource";
import { getResourceManager } from "../storage/resourceManager";
import { Message, MessageType } from "../ws/messageTypes";
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
 * Wait for the connection with the given ID to be usable, to be done before any GraphQL or proxied
 * client queries. This function will "poll" the connection status until it's ready, or until the
 * timeout is reached.
 *
 * For `CCLOUD` connections, this will wait for the CCloud state to be anything other than `NONE` or `ATTEMPTING`.
 *
 * For `DIRECT` connections, this will wait for Kafka and Schema Registry states to be anything other
 * than `ATTEMPTING`.
 */

export async function waitForConnectionToBeUsable(
  id: ConnectionId,
  timeoutMs: number = 15_000,
): Promise<Connection | null> {
  let connection: Connection | null = null;

  let kafkaFailed: string | undefined;
  let schemaRegistryFailed: string | undefined;
  let ccloudFailed: string | undefined;

  const startTime = Date.now();

  let type: ConnectionType | undefined;
  let status: ConnectionStatus | undefined;

  // Filter passed to .waitForConnectionUpdate() to decide if an updated connection obj
  // meets terminal state criteria.
  const eventFilter: ConnectionUpdateFilter = (checkedConnection: Connection): boolean => {
    type = checkedConnection.spec.type!;
    status = checkedConnection.status;

    switch (type) {
      case ConnectionType.Direct: {
        // direct connections will use an `ATTEMPTING` status
        const kafkaState: ConnectedState | undefined = status.kafka_cluster?.state;
        const schemaRegistryState: ConnectedState | undefined = status.schema_registry?.state;
        const isAttempting = kafkaState === "ATTEMPTING" || schemaRegistryState === "ATTEMPTING";
        if (isAttempting) {
          connectionLoading.fire(id);
          logger.debug(
            "waitForConnectionToBeUsable() filter lambda: still waiting for direct connection to be usable",
            {
              id,
              type,
              kafkaState,
              schemaRegistryState,
            },
          );
          // fail the filter. We're still waiting for the connection to be usable.
          return false;
        }
        connectionUsable.fire(id);
        // notify subscribers that the "environment" has changed since direct connections are treated
        // as environment-specific resources
        environmentChanged.fire(id);
        if (kafkaState === "FAILED") {
          kafkaFailed = status.kafka_cluster?.errors?.sign_in?.message;
        }
        if (schemaRegistryState === "FAILED") {
          schemaRegistryFailed = status.schema_registry?.errors?.sign_in?.message;
        }
        return true;
      }
      case ConnectionType.Ccloud: {
        // CCloud connections don't transition from `NONE` to `ATTEMPTING` to `SUCCESS`, just directly
        // from `NONE` to `SUCCESS` (or `FAILED`)
        const ccloudState = status.ccloud!.state;
        if (ccloudState === "NONE") {
          logger.debug(
            "waitForConnectionToBeUsable() filter lambda: still waiting for ccloud connection to be usable",
            {
              id,
              type,
              ccloudState,
            },
          );
          return false;
        }
        if (ccloudState === "FAILED") {
          ccloudFailed = status.ccloud?.errors?.sign_in?.message;
        }
        return true;
      }
      // TODO: local connections?
    }

    logger.warn("waitForConnectionToBeUsable() filter lambda fallthrough false.");
    return false;
  };

  logger.debug(
    `waitForConnectionToBeUsable(): Calling ConnectionStateWatcher.waitForConnectionUpdate() for ${id} to wait for it to become useable soon.`,
  );
  const connectionStateWatcher = ConnectionStateWatcher.getInstance();
  connection = await connectionStateWatcher.waitForConnectionUpdate(id, eventFilter, timeoutMs);
  if (!connection) {
    const msg = `waitForConnectionToBeUsable(): connection ${id} did not become usable within ${timeoutMs}ms`;
    // reset any "loading" state for this connection
    connectionUsable.fire(id);
    // and trigger any kind of Topics/Schemas refresh to reenforce the error state / clear out any
    // old data
    environmentChanged.fire(id);
    logger.error(msg);
    return null;
  }

  logger.debug(
    `waitForConnectionToBeUsable(): connection is usable after ${Date.now() - startTime}ms, returning`,
    {
      id,
      type,
      ccloud: status!.ccloud?.state,
      ccloudFailed,
      kafka: status!.kafka_cluster?.state,
      kafkaFailed,
      schemaRegistry: status!.schema_registry?.state,
      schemaRegistryFailed,
    },
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
 * Definition for lambdas passed into ConnectionStateWatcher.waitForConnectionUpdate() to determine
 * if a connection update should be considered for further processing. Allows for filtering out
 * updates that are not relevant to the caller w/o gaps where there could be 0 observers and therefore
 * missed updates.
 * */
export type ConnectionUpdateFilter = (connection: Connection, wasCachedUpdate: boolean) => boolean;

export class ConnectionStateWatcher {
  // Singleton instance
  private static instance: ConnectionStateWatcher;

  // connection id -> latest Connection info announced by sidecar
  private connectionStates: Map<string, SingleConnectionState> = new Map();

  public static getInstance(): ConnectionStateWatcher {
    if (!ConnectionStateWatcher.instance) {
      ConnectionStateWatcher.instance = new ConnectionStateWatcher();
    }
    return ConnectionStateWatcher.instance;
  }

  private constructor() {
    // Register handleConnectionUpdateEvent as a listener for CONNECTION_EVENT messages
    WebsocketManager.getInstance().subscribe(
      MessageType.CONNECTION_EVENT,
      this.handleConnectionUpdateEvent.bind(this),
    );
  }

  /**
   * Get the most recent Connection description for the given connection ID.
   * Will return null if no CONNECTION_EVENT websocket messages have been
   * received for this connection.
   */
  getLatestConnectionUpdate(connectionId: string): Connection | null {
    const singleConnectionState = this.connectionStates.get(connectionId);
    return singleConnectionState?.mostRecentConnection || null;
  }

  /**
   * Wait at most N millis for this connection to be updated with an event from sidecar.
   * Resolves with the updated Connection or null if the timeout is reached.
   * If `returnExistingStateIfPresent` is true, and there is an existing Connection state for the requested
   * connection id, then the existing state will be returned immediately without waiting for the next update.
   */
  async waitForConnectionUpdate(
    connectionId: string,
    filter: ConnectionUpdateFilter,
    timeoutMs: number = 15_000,
  ): Promise<Connection | null> {
    let singleConnectionState = this.connectionStates.get(connectionId);
    if (!singleConnectionState) {
      // insert a new entry to track this connection
      singleConnectionState = new SingleConnectionState();
      this.connectionStates.set(connectionId, singleConnectionState);
    } else {
      // If we already have a connection state, and we're allowed to return the existing state if
      // present, then return the existing state immediately. Otherwise we'll wait for
      // the next recieved update.
      if (
        singleConnectionState.mostRecentConnection &&
        filter(singleConnectionState.mostRecentConnection, true)
      ) {
        const connType = singleConnectionState.mostRecentConnection.spec.type!;
        logger.debug(
          `waitForConnectionUpdate(): Short-circuit returning existing connection state for ${connType} connection ${connectionId}`,
        );
        return singleConnectionState.mostRecentConnection;
      }
    }
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        // Did not get an update within the timeout.
        logger.warn(
          `ConnectionStateWatcher waitForConnectionUpdate(): Timed out waiting for connection update for connection ${connectionId}`,
        );
        // cancel the event listner.
        dispose.dispose();
        // and indicate the timeout to the caller.
        resolve(null);
      }, timeoutMs);
      logger.debug(
        `ConnectionStateWatcher waitForConnectionUpdate(): registering observer for updates on  ${connectionId}`,
      );
      const dispose = singleConnectionState.eventEmitter.event((connection: Connection) => {
        const connType = connection.spec.type!;
        logger.debug(
          `ConnectionStateWatcher waitForConnectionUpdate(): Received connection update for ${connType} connection ${connectionId}`,
        );
        if (filter(connection, false)) {
          logger.debug(
            "ConnectionStateWatcher waitForConnectionUpdate(): passed filter, resolving",
          );
          // cancel the timeout.
          clearTimeout(timeout);
          // deregister this listener.
          dispose.dispose();
          // return happy to the caller.
          resolve(connection);
        } else {
          logger.debug(
            "ConnectionStateWatcher waitForConnectionUpdate(): did not pass filter, waiting for next update",
          );
          // leave the listener registered for the next update (or until )
        }
      });
    });
  }

  /** Handle connection state change events from sidecar connections. */
  async handleConnectionUpdateEvent(message: Message<MessageType.CONNECTION_EVENT>): Promise<void> {
    const connectionEvent = message.body;
    const connectionId = connectionEvent.connection.id;
    const connection: Connection = connectionEvent.connection;

    logger.debug(
      `ConnectionStateWatcher: received websocket connection event for connection id ${connectionId}`,
    );

    let singleConnectionState = this.connectionStates.get(connectionId);
    if (!singleConnectionState) {
      // insert a new entry to track this connection's updates.
      logger.debug("ConnectionStateWatcher: creating new connection state entry.");
      singleConnectionState = new SingleConnectionState();
      this.connectionStates.set(connectionId, singleConnectionState);
    }

    // Store this most recent Connection description including its spec.
    singleConnectionState.mostRecentConnection = connection;
    // Fire the event emitter for this connection to alert any listeners about the update.
    logger.debug("ConnectionStateWatcher: firing event to inform any observers.");
    singleConnectionState.eventEmitter.fire(connection);
  }
}

class SingleConnectionState {
  mostRecentConnection: Connection | null = null;
  eventEmitter: EventEmitter<Connection> = new EventEmitter<Connection>();
}
