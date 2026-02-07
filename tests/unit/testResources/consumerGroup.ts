import { ConnectionType } from "../../../src/clients/sidecar";
import { CCLOUD_CONNECTION_ID, LOCAL_CONNECTION_ID } from "../../../src/constants";
import { Consumer, ConsumerGroup, ConsumerGroupState } from "../../../src/models/consumerGroup";
import { TEST_DIRECT_CONNECTION_ID } from "./connection";
import {
  TEST_CCLOUD_KAFKA_CLUSTER,
  TEST_DIRECT_KAFKA_CLUSTER,
  TEST_LOCAL_KAFKA_CLUSTER,
} from "./kafkaCluster";

/** Create a {@link ConsumerGroup} for testing purposes. */
export function createConsumerGroup(
  args: {
    connectionId: string;
    connectionType: ConnectionType;
    environmentId: string;
    clusterId: string;
  } & Partial<ConsumerGroup>,
): ConsumerGroup {
  return new ConsumerGroup({
    connectionId: args.connectionId,
    connectionType: args.connectionType,
    environmentId: args.environmentId,
    clusterId: args.clusterId,
    consumerGroupId: args.consumerGroupId ?? "test-consumer-group",
    state: args.state ?? ConsumerGroupState.Stable,
    isSimple: args.isSimple ?? false,
    partitionAssignor: args.partitionAssignor ?? "range",
    coordinatorId: args.coordinatorId ?? 0,
    members: args.members ?? [],
  });
}

/** Create a {@link Consumer} for testing purposes. */
export function createConsumerGroupMember(
  args: {
    connectionId: string;
    connectionType: ConnectionType;
    environmentId: string;
    clusterId: string;
    consumerGroupId: string;
  } & Partial<Consumer>,
): Consumer {
  return new Consumer({
    connectionId: args.connectionId,
    connectionType: args.connectionType,
    environmentId: args.environmentId,
    clusterId: args.clusterId,
    consumerGroupId: args.consumerGroupId,
    consumerId: args.consumerId ?? "test-consumer-1",
    clientId: args.clientId ?? "test-client",
    instanceId: args.instanceId ?? null,
  });
}

export const TEST_CCLOUD_CONSUMER_GROUP_ID = "test-ccloud-consumer-group";
export const TEST_CCLOUD_CONSUMER_GROUP = createConsumerGroup({
  connectionId: CCLOUD_CONNECTION_ID,
  connectionType: ConnectionType.Ccloud,
  environmentId: TEST_CCLOUD_KAFKA_CLUSTER.environmentId,
  clusterId: TEST_CCLOUD_KAFKA_CLUSTER.id,
  consumerGroupId: TEST_CCLOUD_CONSUMER_GROUP_ID,
  members: [
    createConsumerGroupMember({
      connectionId: CCLOUD_CONNECTION_ID,
      connectionType: ConnectionType.Ccloud,
      environmentId: TEST_CCLOUD_KAFKA_CLUSTER.environmentId,
      clusterId: TEST_CCLOUD_KAFKA_CLUSTER.id,
      consumerGroupId: TEST_CCLOUD_CONSUMER_GROUP_ID,
      consumerId: "consumer-ccloud-1",
      clientId: "my-ccloud-app",
    }),
  ],
});
export const TEST_CCLOUD_CONSUMER = TEST_CCLOUD_CONSUMER_GROUP.members[0];

export const TEST_DIRECT_CONSUMER_GROUP_ID = "test-direct-consumer-group";
export const TEST_DIRECT_CONSUMER_GROUP = createConsumerGroup({
  connectionId: TEST_DIRECT_CONNECTION_ID,
  connectionType: ConnectionType.Direct,
  environmentId: TEST_DIRECT_KAFKA_CLUSTER.environmentId,
  clusterId: TEST_DIRECT_KAFKA_CLUSTER.id,
  consumerGroupId: TEST_DIRECT_CONSUMER_GROUP_ID,
  members: [
    createConsumerGroupMember({
      connectionId: TEST_DIRECT_CONNECTION_ID,
      connectionType: ConnectionType.Direct,
      environmentId: TEST_DIRECT_KAFKA_CLUSTER.environmentId,
      clusterId: TEST_DIRECT_KAFKA_CLUSTER.id,
      consumerGroupId: TEST_DIRECT_CONSUMER_GROUP_ID,
      consumerId: "consumer-direct-1",
      clientId: "my-direct-app",
    }),
  ],
});
export const TEST_DIRECT_CONSUMER = TEST_DIRECT_CONSUMER_GROUP.members[0];

export const TEST_LOCAL_CONSUMER_GROUP_ID = "test-local-consumer-group";
export const TEST_LOCAL_CONSUMER_GROUP = createConsumerGroup({
  connectionId: LOCAL_CONNECTION_ID,
  connectionType: ConnectionType.Local,
  environmentId: TEST_LOCAL_KAFKA_CLUSTER.environmentId,
  clusterId: TEST_LOCAL_KAFKA_CLUSTER.id,
  consumerGroupId: TEST_LOCAL_CONSUMER_GROUP_ID,
  members: [
    createConsumerGroupMember({
      connectionId: LOCAL_CONNECTION_ID,
      connectionType: ConnectionType.Local,
      environmentId: TEST_LOCAL_KAFKA_CLUSTER.environmentId,
      clusterId: TEST_LOCAL_KAFKA_CLUSTER.id,
      consumerGroupId: TEST_LOCAL_CONSUMER_GROUP_ID,
      consumerId: "consumer-local-1",
      clientId: "my-local-app",
    }),
  ],
});
export const TEST_LOCAL_CONSUMER = TEST_LOCAL_CONSUMER_GROUP.members[0];
