/**
 * Default image to use for local Kafka (broker) container(s).
 *
 * Must match the default value in the "confluent.docker.localKafkaImage" configuration in package.json.
 */
export const DEFAULT_KAFKA_IMAGE_REPO = "confluentinc/confluent-local";

/**
 * Default image to use for the local Schema Registry container.
 *
 * Must match the default value in the "confluent.docker.localSchemaRegistryImage" configuration in package.json.
 */
export const DEFAULT_SCHEMA_REGISTRY_REPO = "confluentinc/cp-schema-registry";

/**
 * Default image tag to use for local Kafka (broker) container(s).
 *
 * Must match the default value in the "confluent.docker.localKafkaImageTag" configuration in package.json.
 */
export const DEFAULT_KAFKA_IMAGE_TAG = "latest";

/**
 * Default image tag to use for the local Schema Registry container.
 *
 * Must match the default value in the "confluent.docker.localSchemaRegistryImageTag" configuration in package.json.
 */
export const DEFAULT_SCHEMA_REGISTRY_TAG = "latest";
