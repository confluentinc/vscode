import { commands } from "vscode";

// This is a local cache of the context values since there is no `getContext` command exposed by the
// VS Code API.
const contextValues: Record<string, any> = {};

/**
 * Sets the context value and updates the VS Code UI.
 * @param key The key of the context value (must be defined in {@link ContextValues})
 * @param value The value to set
 */
export async function setContextValue(key: ContextValues, value: any): Promise<void> {
  if (!Object.values(ContextValues).includes(key)) {
    throw new Error(
      `Unknown contextValue "${key}"; ensure this is added to src/context.ts::ContextValues before using in package.json`,
    );
  }
  contextValues[key] = value;
  await commands.executeCommand("setContext", key, value);
}

/**
 * Gets the value from the locally-stored contextValues since there is no `getContext` command
 * exposed by the VS Code API.
 */
export function getContextValue<T>(key: string): T | undefined {
  return contextValues[key] as T | undefined;
}

export enum ContextValues {
  // -- CONTEXT VALUES ONLY SET DURING EXTENSION ACTIVATION --
  /** Array of resources that support the "View in CCloud" action. */
  CCLOUD_RESOURCES = "confluent.ccloudResources",
  /** Array of view IDs that contain Confluent/Kafka resources. */
  VIEWS_WITH_RESOURCES = "confluent.viewsWithResources",
  /** Array of resources that have an `id` property for enabling the `Copy ID` action. */
  RESOURCES_WITH_ID = "confluent.resourcesWithIDs",
  /** Array of resources that have a `name` property for enabling the `Copy Name` action. */
  RESOURCES_WITH_NAMES = "confluent.resourcesWithNames",
  /** Array of resources that have a `uri` property for enabling the `Copy URI` action. */
  RESOURCES_WITH_URIS = "confluent.resourcesWithURIs",

  // -- ADJUSTABLE CONTEXT VALUES --
  /** The user has a valid, authenticated connection to Confluent Cloud.
   * NOTE: this is only controlled by our auth provider. */
  ccloudConnectionAvailable = "confluent.ccloudConnectionAvailable",
  /** A local connection has been made and a local Kafka cluster is available for selecting in the Topics view. */
  localKafkaClusterAvailable = "confluent.localKafkaClusterAvailable",
  /** A local connection has been made and a local Schema Registry is available for selecting in the Schemas view. */
  localSchemaRegistryAvailable = "confluent.localSchemaRegistryAvailable",
  /** A resource has been selected for comparison. */
  resourceSelectedForCompare = "confluent.resourceSelectedForCompare",
  /** The user clicked a Kafka cluster tree item. */
  kafkaClusterSelected = "confluent.kafkaClusterSelected",
  /** The user clicked a Schema Registry tree item. */
  schemaRegistrySelected = "confluent.schemaRegistrySelected",
  /**
   * PREVIEW: Is the "produce message" functionality enabled at all?
   * (This should go away once the `confluent.preview.enableProduceMessages` setting is removed.)
   */
  produceMessagesEnabled = "confluent.produceMessagesEnabled",
}
