import { FlinkAITool } from "../../../src/models/flinkAiTool";
import type { CCloudFlinkDbKafkaCluster } from "../../../src/models/kafkaCluster";
import { TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER } from "./kafkaCluster";

/**
 * Make a quick {@link FlinkAITool} instance for tests.
 * Defaults to being from TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.
 */
export function createFlinkAITool(
  name: string,
  database: CCloudFlinkDbKafkaCluster = TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
): FlinkAITool {
  return new FlinkAITool({
    environmentId: database.environmentId,
    provider: database.provider,
    region: database.region,
    databaseId: database.id,
    name: name,
  });
}
