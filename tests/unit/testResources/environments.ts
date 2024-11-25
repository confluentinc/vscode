import {
  CCloudEnvironment,
  DirectEnvironment,
  LocalEnvironment,
} from "../../../src/models/environment";
import { TEST_DIRECT_CONNECTION_ID, TEST_LOCAL_CONNECTION } from "./connection";

const TEST_ENVIRONMENT_BODY = {
  id: "abc123",
  name: "test-environment",
  kafkaClusters: [],
  schemaRegistry: undefined,
};

export const TEST_CCLOUD_ENVIRONMENT: CCloudEnvironment = CCloudEnvironment.create({
  ...TEST_ENVIRONMENT_BODY,
  id: "env-abc123",
  name: "test-cloud-environment",
  streamGovernancePackage: "NONE",
});

export const TEST_DIRECT_ENVIRONMENT: DirectEnvironment = DirectEnvironment.create({
  ...TEST_ENVIRONMENT_BODY,
  id: "test-direct-connection",
  name: "test-direct-environment",
  connectionId: TEST_DIRECT_CONNECTION_ID,
});

export const TEST_LOCAL_ENVIRONMENT: LocalEnvironment = LocalEnvironment.create({
  ...TEST_ENVIRONMENT_BODY,
  id: TEST_LOCAL_CONNECTION.id,
  name: "test-local-environment",
});

// not tied to the CCloud Environment specifically, but used by CCloud Kafka clusters and Schema Registry
export const TEST_CCLOUD_PROVIDER = "aws";
export const TEST_CCLOUD_REGION = "us-west-2";
