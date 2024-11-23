import { CCloudEnvironment } from "../../../src/models/environment";

export const TEST_CCLOUD_ENVIRONMENT: CCloudEnvironment = CCloudEnvironment.create({
  id: "env-abc123",
  name: "test-environment",
  streamGovernancePackage: "NONE",
  kafkaClusters: [],
  schemaRegistry: undefined,
});

// not tied to the CCloud Environment specifically, but used by CCloud Kafka clusters and Schema Registry
export const TEST_CCLOUD_PROVIDER = "aws";
export const TEST_CCLOUD_REGION = "us-west-2";
