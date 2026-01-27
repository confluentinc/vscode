/**
 * CCloud Session Utilities.
 *
 * Provides functions for checking CCloud authentication state.
 * These functions were previously in src/sidecar/connections/ccloud.ts.
 */

import { ContextValues, getContextValue } from "../context/values";
import {
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
