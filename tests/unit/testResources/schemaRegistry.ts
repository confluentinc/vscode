import { CCloudSchemaRegistry, LocalSchemaRegistry } from "../../../src/models/schemaRegistry";
import { TEST_CCLOUD_ENVIRONMENT, TEST_CCLOUD_PROVIDER, TEST_CCLOUD_REGION } from "./environments";

export const TEST_LOCAL_SCHEMA_REGISTRY: LocalSchemaRegistry = LocalSchemaRegistry.create({
  id: "local-abc123",
  uri: "http://localhost:8081",
});

export const TEST_CCLOUD_SCHEMA_REGISTRY: CCloudSchemaRegistry = CCloudSchemaRegistry.create({
  id: "lsrc-abc123",
  provider: TEST_CCLOUD_PROVIDER.toUpperCase(),
  region: TEST_CCLOUD_REGION,
  uri: `https://psrc-abc123.${TEST_CCLOUD_REGION}.${TEST_CCLOUD_PROVIDER}.confluent.cloud`,
  environmentId: TEST_CCLOUD_ENVIRONMENT.id,
});
