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

  let isCCloud = false;
  if (instanceOfKafkaClusterConfig(config)) {
    isCCloud = config.bootstrap_servers.includes(CCLOUD_DOMAIN_SUBSTRING);
  } else if (instanceOfSchemaRegistryConfig(config)) {
    isCCloud = config.uri.includes(CCLOUD_DOMAIN_SUBSTRING);
  }
  return isCCloud;
}
