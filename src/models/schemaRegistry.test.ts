import * as assert from "assert";
import {
  TEST_CCLOUD_SCHEMA_REGISTRY,
  TEST_DIRECT_SCHEMA_REGISTRY,
  TEST_LOCAL_SCHEMA_REGISTRY,
} from "../../tests/unit/testResources";

describe("SchemaRegistry methods", () => {
  for (const schemaRegistry of [
    TEST_LOCAL_SCHEMA_REGISTRY,
    TEST_CCLOUD_SCHEMA_REGISTRY,
    TEST_DIRECT_SCHEMA_REGISTRY,
  ]) {
    it(`${schemaRegistry.id} schemaRegistryId getter`, () => {
      assert.strictEqual(schemaRegistry.schemaRegistryId, schemaRegistry.id);
    });
  }
});
