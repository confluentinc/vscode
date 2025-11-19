import { FlinkAIConnection } from "../../../src/models/flinkAiConnection";
import type { CCloudFlinkDbKafkaCluster } from "../../../src/models/kafkaCluster";
import { TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER } from "./kafkaCluster";

/**
 * Make a quick {@link FlinkAIConnection} instance for tests.
 * Defaults to being from TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.
 */
export function createFlinkAIConnection(
  name: string,
  database: CCloudFlinkDbKafkaCluster = TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
): FlinkAIConnection {
  return new FlinkAIConnection({
    environmentId: database.environmentId,
    provider: database.provider,
    region: database.region,
    databaseId: database.id,
    name: name,
  });
}
