import { FlinkUdf } from "../../../src/models/flinkUDF";
import { CCloudFlinkDbKafkaCluster } from "../../../src/models/kafkaCluster";
import { TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER } from "./kafkaCluster";

/** Make a quick FlinkUDF instance for tests. Defaults to being from TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER. */
export function createFlinkUDF(
  id: string,
  flinkDbCluster: CCloudFlinkDbKafkaCluster = TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
): FlinkUdf {
  return new FlinkUdf({
    environmentId: flinkDbCluster.environmentId,
    provider: flinkDbCluster.provider,
    region: flinkDbCluster.region,
    databaseId: flinkDbCluster.id,
    id,
    name: `udf-${id}`,
    description: `Description for ${id}`,
  });
}
