import { CCloudEnvironment } from "../../../src/models/environment";
import { TEST_CCLOUD_KAFKA_CLUSTER } from "./kafkaCluster";
import { TEST_CCLOUD_SCHEMA_REGISTRY } from "./schemaRegistry";

export const TEST_CCLOUD_ENVIRONMENT: CCloudEnvironment = CCloudEnvironment.create({
  id: "env-abc123",
  name: "test-environment",
  streamGovernancePackage: "NONE",
  kafkaClusters: [TEST_CCLOUD_KAFKA_CLUSTER],
  schemaRegistry: TEST_CCLOUD_SCHEMA_REGISTRY,
});

// not tied to the CCloud Environment specifically, but used by CCloud Kafka clusters and Schema Registry
export const TEST_CCLOUD_PROVIDER = "aws";
export const TEST_CCLOUD_REGION = "us-west-2";
