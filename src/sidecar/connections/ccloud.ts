import { tryToCreateConnection, tryToDeleteConnection, tryToGetConnection } from ".";
import { Connection } from "../../clients/sidecar";
import { CCLOUD_CONNECTION_ID, CCLOUD_CONNECTION_SPEC } from "../../constants";
import { ContextValues, getContextValue } from "../../context/values";
import { currentKafkaClusterChanged, currentSchemaRegistryChanged } from "../../emitters";
import { Logger } from "../../logging";
import { getResourceManager } from "../../storage/resourceManager";
import { SchemasViewProvider } from "../../viewProviders/schemas";
import { TopicViewProvider } from "../../viewProviders/topics";

const logger = new Logger("sidecar.connections.ccloud");

/** Create the Confluent Cloud {@link Connection} and return it. */
export async function createCCloudConnection(): Promise<Connection> {
  return await tryToCreateConnection(CCLOUD_CONNECTION_SPEC);
}

/** Get the Confluent Cloud {@link Connection} (if it exists). */
export async function getCCloudConnection(): Promise<Connection | null> {
  return await tryToGetConnection(CCLOUD_CONNECTION_ID);
}

/** Delete the existing Confluent Cloud {@link Connection} (if it exists). */
export async function deleteCCloudConnection(): Promise<void> {
  await tryToDeleteConnection(CCLOUD_CONNECTION_ID);
}

export async function clearCurrentCCloudResources() {
  // if the current connection changes or is deleted, we need to clear any associated CCloud resources
  // that may have depended on it:
  // - delete the extension state references to make sure they can't be used
  // - fire events to update things like the Topics view, Schemas view, etc.
  logger.warn("clearing current CCloud resources from extension state");
  await getResourceManager().deleteCCloudResources();

  // If we are looking at a CCloud cluster in the Topics view, we need to clear the current cluster.
  const topicViewProvider = TopicViewProvider.getInstance();
  if (topicViewProvider.isFocusedOnCCloud()) {
    currentKafkaClusterChanged.fire(null);
  }

  // Likewise for the Schema Registry view.
  const schemasViewProvider = SchemasViewProvider.getInstance();
  if (schemasViewProvider.isFocusedOnCCloud()) {
    currentSchemaRegistryChanged.fire(null);
  }
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
