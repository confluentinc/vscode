/**
 * Default image tag to use for the local Schema Registry container.
 *
 * Must match the default value in the "confluent.docker.localSchemaRegistryImageTag" configuration in package.json.
 */
export const DEFAULT_SCHEMA_REGISTRY_TAG = "latest";

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
