import { authentication, AuthenticationSession } from "vscode";
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
} from "../emitters";
import { logResponseError } from "../errors";
import { Logger } from "../logging";
import { ConnectionId } from "../models/resource";
import { getResourceManager } from "../storage/resourceManager";

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
  waitTimeMs: number = 500,
): Promise<Connection | null> {
  let connection: Connection | null = null;

  let kafkaFailed: string | undefined;
  let schemaRegistryFailed: string | undefined;
  let ccloudFailed: string | undefined;

  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const checkedConnection = await tryToGetConnection(id);
    if (!checkedConnection) {
      logger.debug("waiting for connection to be usable", { connectionId: id });
      await new Promise((resolve) => setTimeout(resolve, waitTimeMs));
      continue;
    }

    const type: ConnectionType = checkedConnection.spec.type!;
    const status: ConnectionStatus = checkedConnection.status;

    switch (type) {
      case ConnectionType.Direct: {
        // direct connections will use an `ATTEMPTING` status
        const kafkaState: ConnectedState | undefined = status.kafka_cluster?.state;
        const schemaRegistryState: ConnectedState | undefined = status.schema_registry?.state;
        const isAttempting = kafkaState === "ATTEMPTING" || schemaRegistryState === "ATTEMPTING";
        if (isAttempting) {
          connectionLoading.fire(id);
          logger.debug("still waiting for connection to be usable", {
            id,
            type,
            kafkaState,
            schemaRegistryState,
          });
          await new Promise((resolve) => setTimeout(resolve, waitTimeMs));
          continue;
        }
        connectionUsable.fire(id);
        if (kafkaState === "FAILED") {
          kafkaFailed = status.kafka_cluster?.errors?.sign_in?.message;
        }
        if (schemaRegistryState === "FAILED") {
          schemaRegistryFailed = status.schema_registry?.errors?.sign_in?.message;
        }
        break;
      }
      case ConnectionType.Ccloud: {
        // CCloud connections don't transition from `NONE` to `ATTEMPTING` to `SUCCESS`, just directly
        // from `NONE` to `SUCCESS` (or `FAILED`)
        const ccloudState = status.ccloud!.state;
        if (ccloudState === "NONE") {
          logger.debug("still waiting for connection to be usable", { id, type, ccloudState });
          await new Promise((resolve) => setTimeout(resolve, waitTimeMs));
          continue;
        }
        if (ccloudState === "FAILED") {
          ccloudFailed = status.ccloud?.errors?.sign_in?.message;
        }
        break;
      }
      // TODO: check local connections?
    }

    // if we didn't time out by now through the series of `continue`s, we have a usable connection
    // (or we need to update the logic above for other connection types/states)
    logger.debug("connection is usable, returning", {
      id,
      type,
      ccloud: status.ccloud?.state,
      ccloudFailed,
      kafka: status.kafka_cluster?.state,
      kafkaFailed,
      schemaRegistry: status.schema_registry?.state,
      schemaRegistryFailed,
    });
    connection = checkedConnection;
    break;
  }

  if (!connection) {
    const msg = `Connection ${id} did not become usable within ${timeoutMs}ms`;
    logger.error(msg);
    throw new Error(msg);
  }

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
