import { CCloudResourceLoader } from "../loaders/ccloudResourceLoader";
import { CCloudEnvironment } from "../models/environment";
import type { CCloudFlinkComputePool } from "../models/flinkComputePool";
import type { CCloudFlinkDbKafkaCluster } from "../models/kafkaCluster";
import type { EnvironmentId } from "../models/resource";

/**
 * Validates and retrieves resources needed for a Flink query.
 * Throws detailed, user-facing errors if any resource is missing or invalid.
 *
 * @param params - Resource identifiers
 * @returns Validated resources (environment, database, compute pool)
 * @throws Error with user-friendly message if validation fails
 */
export async function validateFlinkQueryResources(params: {
  environmentId: EnvironmentId;
  databaseId: string;
}): Promise<{
  environment: CCloudEnvironment;
  database: CCloudFlinkDbKafkaCluster;
  computePool: CCloudFlinkComputePool;
}> {
  const loader = CCloudResourceLoader.getInstance();

  // Validate environment
  const environment = await loader.getEnvironment(params.environmentId);
  if (!environment) {
    throw new Error(
      `Unable to open a Flink SQL query because environment "${params.environmentId}" ` +
        "could not be found. Refresh your Confluent Cloud connection and try again.",
    );
  }

  // getEnvironment can return Environment | undefined, but we need CCloudEnvironment
  // CCloudResourceLoader.getEnvironment always returns CCloudEnvironment when found
  if (!(environment instanceof CCloudEnvironment)) {
    throw new Error(
      `Unable to open a Flink SQL query because environment "${params.environmentId}" ` +
        "is not a Confluent Cloud environment.",
    );
  }

  // Validate database
  const database = await loader.getFlinkDatabase(params.environmentId, params.databaseId);
  if (!database) {
    throw new Error(
      `Unable to open a Flink SQL query because the selected database "${params.databaseId}" ` +
        "is not available or is not Flink-enabled. Select a valid Flink database and try again.",
    );
  }

  // Validate compute pool
  const computePool = database.flinkPools[0];
  if (!computePool) {
    throw new Error(
      `Unable to open a Flink SQL query because no compute pool is configured for database ` +
        `"${database.name}". Create or select a compute pool for this database in Confluent Cloud, then try again.`,
    );
  }

  return { environment, database, computePool };
}
