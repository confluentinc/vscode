import { KafkaTopic } from "../../../src/models/topic";
import { TEST_CCLOUD_KAFKA_CLUSTER, TEST_LOCAL_KAFKA_CLUSTER } from "./kafkaCluster";

export const TEST_LOCAL_KAFKA_TOPIC = KafkaTopic.create({
  name: "test-topic",
  is_internal: false,
  replication_factor: 1,
  partition_count: 1,
  partitions: {},
  configs: {},
  clusterId: TEST_LOCAL_KAFKA_CLUSTER.id,
});

export const TEST_CCLOUD_KAFKA_TOPIC = KafkaTopic.create({
  name: "test-topic",
  is_internal: false,
  replication_factor: 1,
  partition_count: 3,
  partitions: {},
  configs: {},
  clusterId: TEST_CCLOUD_KAFKA_CLUSTER.id,
  environmentId: TEST_CCLOUD_KAFKA_CLUSTER.environmentId,
});
