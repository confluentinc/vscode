import {
  instanceOfKafkaClusterConfig,
  instanceOfSchemaRegistryConfig,
  KafkaClusterConfig,
  SchemaRegistryConfig,
} from "../clients/sidecar";

export const CCLOUD_DOMAIN_SUBSTRING = ".confluent.cloud";

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
    hasCCloud = config.bootstrap_servers.includes(CCLOUD_DOMAIN_SUBSTRING);
  } else if (instanceOfSchemaRegistryConfig(config)) {
    hasCCloud = config.uri.includes(CCLOUD_DOMAIN_SUBSTRING);
  }
  return hasCCloud;
}
