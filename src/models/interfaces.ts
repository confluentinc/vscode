/**
 * Interface describing anything relatable back to an environment:
 * - Kafka Clusters
 * - Schema Registries
 * - Kafka Topics
 * - Schemas
 * - ...
 */
export interface EnvironmentResource {
  environmentId: string | undefined;
}
