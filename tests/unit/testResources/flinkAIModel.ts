import { FlinkAIModel } from "../../../src/models/flinkAiModel";
import type { CCloudFlinkDbKafkaCluster } from "../../../src/models/kafkaCluster";
import { TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER } from "./kafkaCluster";

/**
 * Make a quick {@link FlinkAIModel} instance for tests.
 * Defaults to being from TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.
 */
export function createFlinkAIModel(
  name: string,
  database: CCloudFlinkDbKafkaCluster = TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
  defaultVersion: string = "1",
  versionCount: number = 1,
  comment: string | null = null,
  options: Map<string, Map<string, string>> = new Map(),
): FlinkAIModel {
  return new FlinkAIModel({
    environmentId: database.environmentId,
    provider: database.provider,
    region: database.region,
    databaseId: database.id,
    name: name,
    defaultVersion: defaultVersion,
    versionCount: versionCount,
    comment: comment,
    options: options,
  });
}
