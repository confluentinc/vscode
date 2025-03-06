import { LocalResourceWorkflow } from "./base";
import { ConfluentLocalWorkflow } from "./confluent-local";
import { ConfluentPlatformSchemaRegistryWorkflow } from "./cp-schema-registry";

/**
 * Register all available local resource workflow implementations with the base class registry.
 * This should be called during extension activation to ensure workflows are available when needed.
 */
export function registerLocalResourceWorkflows(): void {
  // Kafka workflows
  LocalResourceWorkflow.registerWorkflow(ConfluentLocalWorkflow.getInstance());
  // TODO: Add other Kafka workflows here once we support more images

  // Schema Registry workflows
  LocalResourceWorkflow.registerWorkflow(ConfluentPlatformSchemaRegistryWorkflow.getInstance());

  // TODO: Add other resource kinds here
}
