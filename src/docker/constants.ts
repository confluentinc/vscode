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
 * Default image to use for the local Medusa container.
 *
 * Must match the default value in the "confluent.docker.localMedusaImage" configuration in package.json.
 */
export const DEFAULT_MEDUSA_IMAGE_REPO = "us-east1-docker.pkg.dev/medusa-prod-env/medusa/medusa";

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

/**
 * Default image tag to use for the local Medusa container.
 *
 * Must match the default value in the "confluent.docker.localMedusaImageTag" configuration in package.json.
 */
export const DEFAULT_MEDUSA_IMAGE_TAG = "a736fae";

/** Network name to use when creating new Docker containers from the extension workflows. */
export const DEFAULT_DOCKER_NETWORK = "vscode-confluent-local-network";

/** Label to use when creating containers, to allow for easier identification later. */
export const MANAGED_CONTAINER_LABEL = "io.confluent.vscode.managed";

/** Types of resources that can be locally managed by this extension through the Docker engine API. */
export enum LocalResourceKind {
  Kafka = "Kafka",
  SchemaRegistry = "Schema Registry",
  Medusa = "Medusa",
}
