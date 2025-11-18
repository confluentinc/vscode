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
): FlinkAIModel {
  return new FlinkAIModel({
    environmentId: database.environmentId,
    provider: database.provider,
    region: database.region,
    databaseId: database.id,
    name: name,
  });
}
