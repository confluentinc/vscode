import { AuthenticationSession, authentication } from "vscode";
import { getSidecar } from ".";
import {
  Connection,
  ConnectionSpec,
  ConnectionsResourceApi,
  ResponseError,
} from "../clients/sidecar";
import {
  AUTH_PROVIDER_ID,
  CCLOUD_CONNECTION_ID,
  CCLOUD_CONNECTION_SPEC,
  LOCAL_CONNECTION_ID,
  LOCAL_CONNECTION_SPEC,
} from "../constants";
import { ContextValues, getContextValue } from "../context";
import { currentKafkaClusterChanged, currentSchemaRegistryChanged } from "../emitters";
import { Logger } from "../logging";
import { getResourceManager } from "../storage/resourceManager";

const logger = new Logger("sidecar.connections");

/** Get the existing {@link Connection} (if it exists). */
export async function tryToGetConnection(id: string): Promise<Connection | null> {
  let connection: Connection | null = null;
  const client: ConnectionsResourceApi = (await getSidecar()).getConnectionsResourceApi();
  try {
    connection = await client.gatewayV1ConnectionsIdGet({ id: id });
  } catch (error) {
    if (error instanceof ResponseError) {
      if (error.response.status === 404) {
        logger.debug("No connection found", { connectionId: id });
      } else {
        logger.error("Error response fetching existing connection:", {
          status: error.response.status,
          statusText: error.response.statusText,
          body: JSON.stringify(error.response.body),
          connectionId: id,
        });
      }
    } else {
      // only log the non-404 errors, since we expect a 404 if the connection doesn't exist
      logger.error("Error fetching connection", { error, connectionId: id });
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
export async function tryToCreateConnection(spec: ConnectionSpec): Promise<Connection> {
  let connection: Connection;
  const client: ConnectionsResourceApi = (await getSidecar()).getConnectionsResourceApi();
  try {
    connection = await client.gatewayV1ConnectionsPost({
      ConnectionSpec: spec,
    });
    logger.debug("created new connection:", { type: spec.type });
    return connection;
  } catch (error) {
    logger.error("create connection error:", error);
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
    logger.error("delete connection error:", error);
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

// TODO(shoup): update for direct connections
/** Delete the existing local connection, then recreate it with the new Schema Registry URI to avoid
 * caching issues. */
export async function updateLocalSchemaRegistryURI(uri: string): Promise<void> {
  await deleteLocalConnection();
  const resp: Connection = await tryToCreateConnection({
    ...LOCAL_CONNECTION_SPEC,
    local_config: {
      schema_registry_uri: uri,
    },
  });
  logger.debug("Updated local connection with Schema Registry URI:", resp);
}
