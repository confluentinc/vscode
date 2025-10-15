import type { KafkaClusterConfig, SchemaRegistryConfig } from "../clients/sidecar";
import { instanceOfKafkaClusterConfig, instanceOfSchemaRegistryConfig } from "../clients/sidecar";
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
    hasCCloud = config.bootstrap_servers.includes(CCLOUD_BASE_PATH);
  } else if (instanceOfSchemaRegistryConfig(config)) {
    hasCCloud = config.uri.includes(CCLOUD_BASE_PATH);
  }
  return hasCCloud;
}
