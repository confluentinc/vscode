import type { KafkaClusterConfig, SchemaRegistryConfig } from "../connections";
import { instanceOfKafkaClusterConfig, instanceOfSchemaRegistryConfig } from "../connections";
import { CCLOUD_BASE_PATH } from "../constants";

/**
 * Checks if the given Kafka or Schema Registry configuration is a Confluent Cloud domain.
 * @param config - The {@link KafkaClusterConfig} or {@link SchemaRegistryConfig} to check, if available.
 */
export function hasCCloudDomain(
  config: KafkaClusterConfig | SchemaRegistryConfig | undefined,
): boolean {
  if (!config) {
    return false;
  }

  let hasCCloud = false;
  if (instanceOfKafkaClusterConfig(config)) {
    hasCCloud = config.bootstrapServers.includes(CCLOUD_BASE_PATH);
  } else if (instanceOfSchemaRegistryConfig(config)) {
    hasCCloud = config.uri.includes(CCLOUD_BASE_PATH);
  }
  return hasCCloud;
}
