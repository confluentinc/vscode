import {
  CCloudEnvironment,
  DirectEnvironment,
  LocalEnvironment,
} from "../../../src/models/environment";
import { TEST_DIRECT_CONNECTION_ID, TEST_LOCAL_CONNECTION } from "./connection";

export const TEST_CCLOUD_ENVIRONMENT: CCloudEnvironment = new CCloudEnvironment({
  id: "env-abc123",
  name: "test-cloud-environment",
  streamGovernancePackage: "NONE",
  kafkaClusters: [],
  schemaRegistry: undefined,
});

export const TEST_DIRECT_ENVIRONMENT: DirectEnvironment = new DirectEnvironment({
  connectionId: TEST_DIRECT_CONNECTION_ID,
  id: "test-direct-connection",
  name: "test-direct-environment",
  kafkaClusters: [],
  kafkaConfigured: false,
  schemaRegistry: undefined,
  schemaRegistryConfigured: false,
});

export const TEST_LOCAL_ENVIRONMENT: LocalEnvironment = new LocalEnvironment({
  id: TEST_LOCAL_CONNECTION.id,
  name: "test-local-environment",
  kafkaClusters: [],
  schemaRegistry: undefined,
});

// not tied to the CCloud Environment specifically, but used by CCloud Kafka clusters and Schema Registry
export const TEST_CCLOUD_PROVIDER = "aws";
export const TEST_CCLOUD_REGION = "us-west-2";
