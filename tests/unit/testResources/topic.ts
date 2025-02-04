import { KAFKA_TOPIC_OPERATIONS } from "../../../src/authz/constants";
import { ConnectionType } from "../../../src/clients/sidecar";
import { CCLOUD_CONNECTION_ID, LOCAL_CONNECTION_ID } from "../../../src/constants";
import { KafkaTopic } from "../../../src/models/topic";
import { TEST_DIRECT_CONNECTION_ID } from "./connection";
import {
  TEST_CCLOUD_KAFKA_CLUSTER,
  TEST_DIRECT_KAFKA_CLUSTER,
  TEST_LOCAL_KAFKA_CLUSTER,
} from "./kafkaCluster";

const TEST_KAFKA_TOPIC_BODY = {
  // connectionId: configured below
  // connectionType: configured below
  name: "test-topic",
  is_internal: false,
  replication_factor: 1,
  partition_count: 1,
  partitions: {},
  configs: {},
  // clusterId: configured below
  // environmentId: configured below
  operations: [...KAFKA_TOPIC_OPERATIONS],
  hasSchema: false,
};

export const TEST_LOCAL_KAFKA_TOPIC: KafkaTopic = KafkaTopic.create({
  ...TEST_KAFKA_TOPIC_BODY,
  connectionId: LOCAL_CONNECTION_ID,
  connectionType: ConnectionType.Local,
  name: "test-local-topic",
  partition_count: 1,
  clusterId: TEST_LOCAL_KAFKA_CLUSTER.id,
  environmentId: TEST_LOCAL_KAFKA_CLUSTER.environmentId,
});

export const TEST_CCLOUD_KAFKA_TOPIC: KafkaTopic = KafkaTopic.create({
  ...TEST_KAFKA_TOPIC_BODY,
  connectionId: CCLOUD_CONNECTION_ID,
  connectionType: ConnectionType.Ccloud,
  name: "test-ccloud-topic",
  partition_count: 3,
  clusterId: TEST_CCLOUD_KAFKA_CLUSTER.id,
  environmentId: TEST_CCLOUD_KAFKA_CLUSTER.environmentId,
});

export const TEST_DIRECT_KAFKA_TOPIC: KafkaTopic = KafkaTopic.create({
  ...TEST_KAFKA_TOPIC_BODY,
  connectionId: TEST_DIRECT_CONNECTION_ID,
  connectionType: ConnectionType.Direct,
  name: "test-direct-topic",
  partition_count: 1,
  clusterId: TEST_DIRECT_KAFKA_CLUSTER.id,
  environmentId: TEST_DIRECT_KAFKA_CLUSTER.environmentId,
});
