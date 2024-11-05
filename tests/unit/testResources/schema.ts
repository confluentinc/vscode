import { Schema, SchemaType } from "../../../src/models/schema";
import { TEST_CCLOUD_SCHEMA_REGISTRY } from "./schemaRegistry";

export const TEST_CCLOUD_SCHEMA = Schema.create({
  id: "100001",
  subject: "test-topic-value",
  version: 1,
  type: SchemaType.Avro,
  schemaRegistryId: TEST_CCLOUD_SCHEMA_REGISTRY.id,
  environmentId: TEST_CCLOUD_SCHEMA_REGISTRY.environmentId,
});
