/**
 * Default image to use for local Kafka (broker) container(s).
 *
 * Must match the default value in the "confluent.docker.localKafkaImage" configuration in package.json.
 */
export const DEFAULT_KAFKA_IMAGE_REPO = "confluentinc/confluent-local";

/**
 * Default image tag to use for local Kafka (broker) container(s).
 *
 * Must match the default value in the "confluent.docker.localKafkaImageTag" configuration in package.json.
 */
export const DEFAULT_KAFKA_IMAGE_TAG = "latest";

/** Label to use when creating containers, to allow for easier identification later. */
export const MANAGED_CONTAINER_LABEL = "io.confluent.vscode.managed";

/** Types of resources that can be locally managed by this extension through the Docker engine API. */
export enum LocalResourceKind {
  Kafka = "Kafka",
  SchemaRegistry = "Schema Registry",
}
