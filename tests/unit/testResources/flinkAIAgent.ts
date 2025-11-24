import { FlinkAIAgent } from "../../../src/models/flinkAiAgent";
import type { CCloudFlinkDbKafkaCluster } from "../../../src/models/kafkaCluster";
import { TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER } from "./kafkaCluster";

/**
 * Make a quick {@link FlinkAIAgent} instance for tests.
 * Defaults to being from TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.
 */
export function createFlinkAIAgent(
  name: string,
  flinkDbCluster: CCloudFlinkDbKafkaCluster = TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
): FlinkAIAgent {
  return new FlinkAIAgent({
    environmentId: flinkDbCluster.environmentId,
    provider: flinkDbCluster.provider,
    region: flinkDbCluster.region,
    databaseId: flinkDbCluster.id,
    name: name,
  });
}
