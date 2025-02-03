import {
  CCloudKafkaCluster,
  DirectKafkaCluster,
  LocalKafkaCluster,
} from "../../../src/models/kafkaCluster";
import { TEST_DIRECT_CONNECTION_ID } from "./connection";
import {
  TEST_CCLOUD_ENVIRONMENT_ID,
  TEST_CCLOUD_PROVIDER,
  TEST_CCLOUD_REGION,
} from "./environments";

export const TEST_LOCAL_KAFKA_CLUSTER: LocalKafkaCluster = LocalKafkaCluster.create({
  id: "local-kafka-cluster-abc123",
  bootstrapServers: "localhost:9092",
  uri: "http://localhost:8082",
  name: "test-local-kafka-cluster",
});

export const TEST_CCLOUD_KAFKA_CLUSTER: CCloudKafkaCluster = CCloudKafkaCluster.create({
  id: "lkc-abc123",
  name: "test-ccloud-kafka-cluster",
  provider: TEST_CCLOUD_PROVIDER.toUpperCase(),
  region: TEST_CCLOUD_REGION,
  bootstrapServers: `SASL_SSL://pkc-abc123.${TEST_CCLOUD_REGION}.${TEST_CCLOUD_PROVIDER}.confluent.cloud:443`,
  uri: `https://pkc-abc123.${TEST_CCLOUD_REGION}.${TEST_CCLOUD_PROVIDER}.confluent.cloud:443`,
  environmentId: TEST_CCLOUD_ENVIRONMENT_ID,
});

export const TEST_DIRECT_KAFKA_CLUSTER = DirectKafkaCluster.create({
  connectionId: TEST_DIRECT_CONNECTION_ID,
  // connectionType set by default
  id: "direct-abc123",
  name: "Kafka Cluster",
  bootstrapServers: "localhost:9092",
  uri: "http://localhost:8082",
  // environmentId maps to the connection ID
});
