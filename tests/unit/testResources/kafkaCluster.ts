import { CCloudKafkaCluster, LocalKafkaCluster } from "../../../src/models/kafkaCluster";
import { TEST_CCLOUD_ENVIRONMENT, TEST_CCLOUD_PROVIDER, TEST_CCLOUD_REGION } from "./environments";

export const TEST_LOCAL_KAFKA_CLUSTER = LocalKafkaCluster.create({
  id: "local-abc123",
  bootstrapServers: "localhost:9092",
  uri: "http://localhost:8082",
  name: "test-local-kafka-cluster",
});

export const TEST_CCLOUD_KAFKA_CLUSTER = CCloudKafkaCluster.create({
  id: "lkc-abc123",
  name: "test-ccloud-kafka-cluster",
  provider: TEST_CCLOUD_PROVIDER.toUpperCase(),
  region: TEST_CCLOUD_REGION,
  bootstrapServers: `SASL_SSL://pkc-abc123.${TEST_CCLOUD_REGION}.${TEST_CCLOUD_PROVIDER}.confluent.cloud:443`,
  uri: `https://pkc-abc123.${TEST_CCLOUD_REGION}.${TEST_CCLOUD_PROVIDER}.confluent.cloud:443`,
  environmentId: TEST_CCLOUD_ENVIRONMENT.id,
});
