import { getSidecar } from "..";
import {
  Connection,
  ConnectionSpec,
  ConnectionSpecToJSON,
  ConnectionsResourceApi,
  ResponseError,
} from "../../clients/sidecar";
import { logError } from "../../errors";
import { Logger } from "../../logging";
import { ConnectionId } from "../../models/resource";
import { ConnectionStateWatcher } from "./watcher";

const logger = new Logger("sidecar.connections");

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
    logError(
      error,
      `${dryRun ? "testing" : "creating"} new connection:`,
      { connectionId: spec.id! },
      true,
    );
    throw error;
  }
}

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
      logError(error, "fetching connection", { connectionId: id }, true);
    }
  }
  return connection;
}

/** Update the existing {@link Connection} with the given {@link ConnectionSpec}. */
export async function tryToUpdateConnection(spec: ConnectionSpec): Promise<Connection> {
  // Forget any prior known cached connection state for this connection ID
  // so that any subsequent call to waitForConnectionToBeStable() will be based on post-update state.
  ConnectionStateWatcher.getInstance().purgeCachedConnectionState(spec.id! as ConnectionId);

  let connection: Connection;
  const client: ConnectionsResourceApi = (await getSidecar()).getConnectionsResourceApi();
  try {
    connection = await client.gatewayV1ConnectionsIdPatch({
      id: spec.id!,
      body: ConnectionSpecToJSON(spec),
    });
    logger.debug("updated connection:", { id: connection.id });
    return connection;
  } catch (error) {
    logError(error, "updating connection", { connectionId: spec.id! }, true);
    throw error;
  }
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
    logError(error, "deleting connection", { connectionId: id }, true);
    throw error;
  }
}
