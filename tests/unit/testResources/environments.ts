import {
  CCloudEnvironment,
  DirectEnvironment,
  LocalEnvironment,
} from "../../../src/models/environment";
import { EnvironmentId } from "../../../src/models/resource";
import { TEST_DIRECT_CONNECTION_ID, TEST_LOCAL_CONNECTION } from "./connection";

export const TEST_CCLOUD_ENVIRONMENT_ID = "env-abc123" as EnvironmentId;
export const TEST_CCLOUD_ENVIRONMENT: CCloudEnvironment = new CCloudEnvironment({
  id: TEST_CCLOUD_ENVIRONMENT_ID,
  name: "test-cloud-environment",
  streamGovernancePackage: "NONE",
  kafkaClusters: [],
  schemaRegistry: undefined,
});

export const TEST_DIRECT_ENVIRONMENT_ID = "test-direct-connection" as EnvironmentId;
export const TEST_DIRECT_ENVIRONMENT: DirectEnvironment = new DirectEnvironment({
  connectionId: TEST_DIRECT_CONNECTION_ID,
  id: TEST_DIRECT_ENVIRONMENT_ID,
  name: "test-direct-environment",
  kafkaClusters: [],
  kafkaConfigured: false,
  schemaRegistry: undefined,
  schemaRegistryConfigured: false,
});

export const TEST_LOCAL_ENVIRONMENT_ID = TEST_LOCAL_CONNECTION.id as unknown as EnvironmentId;
export const TEST_LOCAL_ENVIRONMENT: LocalEnvironment = new LocalEnvironment({
  id: TEST_LOCAL_ENVIRONMENT_ID,
  name: "test-local-environment",
  kafkaClusters: [],
  schemaRegistry: undefined,
});

// not tied to the CCloud Environment specifically, but used by CCloud Kafka clusters and Schema Registry
export const TEST_CCLOUD_PROVIDER = "aws";
export const TEST_CCLOUD_REGION = "us-west-2";
