/**
 * CCloud Session Utilities.
 *
 * Provides functions for checking CCloud authentication state and managing
 * CCloud connections. These functions were previously in src/sidecar/connections/ccloud.ts.
 */

import { AuthService } from "../auth/oauth2/authService";
import { ConnectionManager } from "../connections/connectionManager";
import { ConnectedState, type Connection, type ConnectionId } from "../connections/types";
import { CCLOUD_CONNECTION_ID, CCLOUD_CONNECTION_SPEC } from "../constants";
import { ContextValues, getContextValue, setContextValue } from "../context/values";
import {
  ccloudConnected,
  flinkDatabaseViewResourceChanged,
  schemasViewResourceChanged,
  topicsViewResourceChanged,
} from "../emitters";
import { CCloudResourceLoader } from "../loaders";
import { Logger } from "../logging";
import { FlinkDatabaseViewProvider } from "../viewProviders/flinkDatabase";
import { SchemasViewProvider } from "../viewProviders/schemas";
import { TopicViewProvider } from "../viewProviders/topics";

const logger = new Logger("authn.ccloudSession");

/** How long to wait for a connection to stabilize (ms). */
const CONNECTION_STABLE_TIMEOUT_MS = 60_000;

/** Polling interval when waiting for connection stability (ms). */
const CONNECTION_STABLE_POLL_INTERVAL_MS = 500;

/**
 * Do we currently have a CCloud connection (authenticated session)?
 *
 * This is the fastest way to check if the user is connected to Confluent Cloud - no round trips.
 * At extension startup we set the initial context value to false, and any changes via the CCloud
 * auth provider will update this value.
 */
export function hasCCloudAuthSession(): boolean {
  const isCcloudConnected: boolean | undefined = getContextValue(
    ContextValues.ccloudConnectionAvailable,
  );
  return !!isCcloudConnected;
}

/**
 * Gets the current CCloud connection if one exists.
 * @returns The Connection object or null if no connection exists.
 */
export async function getCCloudConnection(): Promise<Connection | null> {
  const manager = ConnectionManager.getInstance();
  const handler = manager.getConnection(CCLOUD_CONNECTION_ID);

  if (!handler) {
    return null;
  }

  // Wait for handler initialization to complete (important on extension restart
  // when handler is created with existing tokens but needs to initialize status)
  if ("initialized" in handler && handler.initialized instanceof Promise) {
    await handler.initialized;
  }

  // Get sign-in URI from AuthService (will reuse existing PKCE state if valid)
  const authService = AuthService.getInstance();
  const signInUri = await authService.getOrCreateSignInUri();

  const status = await handler.getStatus();
  return {
    spec: handler.spec,
    status,
    metadata: {
      signInUri,
    },
  };
}

/**
 * Clear all current CCloud resources from extension state.
 *
 * Called when the CCloud connection changes or is deleted. This clears any associated CCloud
 * resources that may have depended on the connection and fires events to update the UI views.
 */
export async function clearCurrentCCloudResources(): Promise<void> {
  logger.warn("clearing current CCloud resources from extension state");
  const loader = CCloudResourceLoader.getInstance();
  await loader.reset();

  // If we are looking at a CCloud cluster in the Topics view, we need to clear the current cluster.
  const topicViewProvider = TopicViewProvider.getInstance();
  if (topicViewProvider.isFocusedOnCCloud()) {
    topicsViewResourceChanged.fire(null);
  }

  // Likewise for the Schema Registry view.
  const schemasViewProvider = SchemasViewProvider.getInstance();
  if (schemasViewProvider.isFocusedOnCCloud()) {
    schemasViewResourceChanged.fire(null);
  }

  // Likewise for the Flink Database view, which can only ever show CCloud resources.
  const flinkDatabaseViewProvider = FlinkDatabaseViewProvider.getInstance();
  if (flinkDatabaseViewProvider.resource != null) {
    flinkDatabaseViewResourceChanged.fire(null);
  }
}

/**
 * Creates the CCloud connection if it doesn't already exist.
 * @returns The created Connection object with current status.
 */
export async function createCCloudConnection(): Promise<Connection> {
  const manager = ConnectionManager.getInstance();
  let handler = manager.getConnection(CCLOUD_CONNECTION_ID);

  if (!handler) {
    handler = await manager.createConnection(CCLOUD_CONNECTION_SPEC);
  }

  // Wait for handler initialization to complete (important on extension restart
  // when handler is created with existing tokens but needs to initialize status)
  if ("initialized" in handler && handler.initialized instanceof Promise) {
    await handler.initialized;
  }

  // Get sign-in URI from AuthService (generates new PKCE state if needed)
  const authService = AuthService.getInstance();
  const signInUri = await authService.getOrCreateSignInUri();

  const status = await handler.getStatus();

  // If the connection is now authenticated, set the context value and fire the connected event.
  // This ensures the UI reflects the connection state after rehydration.
  if (status.ccloud?.state === ConnectedState.SUCCESS) {
    await setContextValue(ContextValues.ccloudConnectionAvailable, true);
    ccloudConnected.fire(true);
  }

  return {
    spec: handler.spec,
    status,
    metadata: {
      signInUri,
    },
  };
}

/**
 * Deletes the CCloud connection.
 * If the connection doesn't exist, this is a no-op.
 */
export async function deleteCCloudConnection(): Promise<void> {
  const manager = ConnectionManager.getInstance();
  const handler = manager.getConnection(CCLOUD_CONNECTION_ID);

  if (handler) {
    await manager.deleteConnection(CCLOUD_CONNECTION_ID);
    logger.info("CCloud connection deleted");
  }
}

/**
 * Waits for a connection to reach a stable state.
 *
 * A connection is considered stable when it's either successfully connected
 * or has failed. This function polls the connection status until it stabilizes
 * or the timeout is reached.
 *
 * @param connectionId The ID of the connection to wait for.
 * @param timeoutMs Maximum time to wait (defaults to 60 seconds).
 * @returns The Connection object once stable, or null if timeout/not found.
 */
export async function waitForConnectionToBeStable(
  connectionId: ConnectionId,
  timeoutMs: number = CONNECTION_STABLE_TIMEOUT_MS,
): Promise<Connection | null> {
  const manager = ConnectionManager.getInstance();
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const handler = manager.getConnection(connectionId);
    if (!handler) {
      logger.warn(`Connection ${connectionId} not found`);
      return null;
    }

    const status = await handler.getStatus();
    const ccloudState = status.ccloud?.state;
    const kafkaState = status.kafkaCluster?.state;
    const srState = status.schemaRegistry?.state;

    // Check if any state is stable (SUCCESS or FAILED)
    const isStable =
      ccloudState === ConnectedState.SUCCESS ||
      ccloudState === ConnectedState.FAILED ||
      kafkaState === ConnectedState.SUCCESS ||
      kafkaState === ConnectedState.FAILED ||
      srState === ConnectedState.SUCCESS ||
      srState === ConnectedState.FAILED;

    if (isStable) {
      // Get sign-in URI from AuthService
      const authService = AuthService.getInstance();
      const signInUri = await authService.getOrCreateSignInUri();

      return {
        spec: handler.spec,
        status,
        metadata: {
          signInUri,
        },
      };
    }

    // Wait before polling again
    await new Promise((resolve) => setTimeout(resolve, CONNECTION_STABLE_POLL_INTERVAL_MS));
  }

  logger.warn(`Timeout waiting for connection ${connectionId} to stabilize`);
  return null;
}
