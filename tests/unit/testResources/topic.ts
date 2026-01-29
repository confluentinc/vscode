import { KAFKA_TOPIC_OPERATIONS } from "../../../src/authz/constants";
import { ConnectionType } from "../../../src/connections";
import { CCLOUD_CONNECTION_ID, LOCAL_CONNECTION_ID } from "../../../src/constants";
import { KafkaTopic } from "../../../src/models/topic";
import { TEST_DIRECT_CONNECTION_ID } from "./connection";
import {
  TEST_CCLOUD_KAFKA_CLUSTER,
  TEST_DIRECT_KAFKA_CLUSTER,
  TEST_LOCAL_KAFKA_CLUSTER,
} from "./kafkaCluster";

/** Create a {@link KafkaTopic} for testing purposes. */
export function createKafkaTopic(
  args: {
    connectionId: string;
    connectionType: ConnectionType;
    environmentId: string;
    clusterId: string;
  } & Partial<KafkaTopic>,
): KafkaTopic {
  return new KafkaTopic({
    connectionId: args.connectionId,
    connectionType: args.connectionType,
    environmentId: args.environmentId,
    clusterId: args.clusterId,
    // optional properties with defaults
    name: args.name ?? "test-topic",
    replication_factor:
      args.replication_factor ?? (args.connectionType === ConnectionType.Ccloud ? 3 : 1),
    partition_count: args.partition_count ?? 1,
    partitions: args.partitions ?? {},
    configs: args.configs ?? {},
    is_internal: args.is_internal ?? false,
    operations: args.operations ?? [...KAFKA_TOPIC_OPERATIONS],
    operationsKnown: args.operationsKnown ?? true,
    isFlinkable: args.isFlinkable ?? false,
    children: args.children ?? [],
  });
}

export const TEST_LOCAL_KAFKA_TOPIC = createKafkaTopic({
  connectionId: LOCAL_CONNECTION_ID,
  connectionType: ConnectionType.Local,
  environmentId: TEST_LOCAL_KAFKA_CLUSTER.environmentId,
  clusterId: TEST_LOCAL_KAFKA_CLUSTER.id,
  name: "test-local-topic",
});

export const TEST_CCLOUD_KAFKA_TOPIC = createKafkaTopic({
  connectionId: CCLOUD_CONNECTION_ID,
  connectionType: ConnectionType.Ccloud,
  environmentId: TEST_CCLOUD_KAFKA_CLUSTER.environmentId,
  clusterId: TEST_CCLOUD_KAFKA_CLUSTER.id,
  name: "test-ccloud-topic",
  partition_count: 3,
});

export const TEST_DIRECT_KAFKA_TOPIC = createKafkaTopic({
  connectionId: TEST_DIRECT_CONNECTION_ID,
  connectionType: ConnectionType.Direct,
  environmentId: TEST_DIRECT_KAFKA_CLUSTER.environmentId,
  clusterId: TEST_DIRECT_KAFKA_CLUSTER.id,
  name: "test-direct-topic",
});
