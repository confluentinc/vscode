import { AuthenticationSession, authentication } from "vscode";
import { getSidecar } from ".";
import { Connection, ConnectionsResourceApi, ResponseError } from "../clients/sidecar";
import { AUTH_PROVIDER_ID, CCLOUD_CONNECTION_ID, CCLOUD_CONNECTION_SPEC } from "../constants";
import { ContextValues, getContextValue } from "../context";
import { currentKafkaClusterChanged, currentSchemaRegistryChanged } from "../emitters";
import { Logger } from "../logging";
import { getResourceManager } from "../storage/resourceManager";

const logger = new Logger("sidecar.connections");

/** Get the Confluent Cloud {@link Connection} (if it exists). */
export async function getCCloudConnection(): Promise<Connection | null> {
  let connection: Connection | null = null;
  const client = (await getSidecar()).getConnectionsResourceApi();
  try {
    connection = await client.gatewayV1ConnectionsIdGet({ id: CCLOUD_CONNECTION_ID });
  } catch (e) {
    if (!(e instanceof ResponseError && e.response.status === 404)) {
      // only log the non-404 errors, since we expect a 404 if the connection doesn't exist
      logger.error("Error getting existing connection", e);
    }
  }
  return connection;
}

/** Create the Confluent Cloud {@link Connection} and return it. */
export async function createCCloudConnection(): Promise<Connection> {
  // create the initial Connection object, which will be kept in sidecar memory as well as
  // in the extension's global state
  let connection: Connection;
  const client: ConnectionsResourceApi = (await getSidecar()).getConnectionsResourceApi();
  try {
    connection = await client.gatewayV1ConnectionsPost({
      ConnectionSpec: CCLOUD_CONNECTION_SPEC,
    });
    logger.debug("created new CCloud connection");
    return connection;
  } catch (error) {
    logger.error("create connection error", error);
    throw new Error("Error while trying to create new connection. Please try again.");
  }
}

/** Delete the existing Confluent Cloud {@link Connection} (if it exists). */
export async function deleteCCloudConnection(): Promise<void> {
  const client = (await getSidecar()).getConnectionsResourceApi();
  try {
    await client.gatewayV1ConnectionsIdDelete({ id: CCLOUD_CONNECTION_ID });
    logger.debug("deleted existing CCloud connection");
  } catch (e) {
    logger.error("Error deleting connection", e);
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
