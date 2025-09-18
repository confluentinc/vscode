import { Environment } from "../models/environment";
import { CCloudFlinkDbKafkaCluster, CCloudKafkaCluster } from "../models/kafkaCluster";

/**
 * Extracts the page token from a next page URL.
 */
export function extractPageToken(nextUrl: string | undefined): string | undefined {
  if (!nextUrl) return undefined;
  try {
    const url = new URL(nextUrl);
    return url.searchParams.get("page_token") ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Finds Flink-capable databases in the given environment.
 * @param environment The environment to search for Flink-capable databases.
 * @returns An array of Flink-capable database clusters.
 */
export function findFlinkDatabases(environment: Environment): CCloudFlinkDbKafkaCluster[] {
  const flinkDatabases = environment.kafkaClusters
    .filter(
      (cluster): cluster is CCloudKafkaCluster =>
        "isFlinkable" in cluster && typeof cluster.isFlinkable === "function",
    )
    .filter((cluster): cluster is CCloudFlinkDbKafkaCluster => cluster.isFlinkable());
  if (flinkDatabases.length === 0) {
    throw new Error(`No Flink-capable databases found in environment ${environment.id}`);
  }
  return flinkDatabases;
}
