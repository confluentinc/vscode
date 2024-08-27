import { SchemaRegistryCluster } from "../../../src/models/schemaRegistry";
import { TEST_CCLOUD_ENVIRONMENT, TEST_CCLOUD_PROVIDER, TEST_CCLOUD_REGION } from "./environments";

export const TEST_SCHEMA_REGISTRY: SchemaRegistryCluster = SchemaRegistryCluster.create({
  id: "lsrc-abc123",
  provider: TEST_CCLOUD_PROVIDER.toUpperCase(),
  region: TEST_CCLOUD_REGION,
  uri: `https://psrc-abc123.${TEST_CCLOUD_REGION}.${TEST_CCLOUD_PROVIDER}.confluent.cloud`,
  environmentId: TEST_CCLOUD_ENVIRONMENT.id,
});
