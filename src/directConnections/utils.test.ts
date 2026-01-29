import * as assert from "assert";
import { TEST_DIRECT_CONNECTION_FORM_SPEC } from "../../tests/unit/testResources/connection";
import { CCLOUD_BASE_PATH } from "../constants";
import { hasCCloudDomain } from "./utils";

describe("directConnections/utils.ts", function () {
  describe("hasCCloudDomain()", function () {
    it(`should return true when a Kafka config's bootstrapServers includes "${CCLOUD_BASE_PATH}"`, function () {
      const spec = TEST_DIRECT_CONNECTION_FORM_SPEC;
      spec.kafkaCluster = {
        bootstrapServers: `pkc-123.region.provider.${CCLOUD_BASE_PATH}:9092`,
      };

      const result = hasCCloudDomain(spec.kafkaCluster);

      assert.strictEqual(result, true);
    });

    it(`should return false when a Kafka config's bootstrapServers does not include "${CCLOUD_BASE_PATH}"`, function () {
      const spec = TEST_DIRECT_CONNECTION_FORM_SPEC;
      spec.kafkaCluster = {
        bootstrapServers: "localhost:9092",
      };

      const result = hasCCloudDomain(spec.kafkaCluster);

      assert.strictEqual(result, false);
    });

    it(`should return true when a Schema Registry config's uri includes "${CCLOUD_BASE_PATH}"`, function () {
      const spec = TEST_DIRECT_CONNECTION_FORM_SPEC;
      spec.schemaRegistry = {
        uri: `https://pkc-123.region.provider.${CCLOUD_BASE_PATH}`,
      };

      const result = hasCCloudDomain(spec.schemaRegistry);

      assert.strictEqual(result, true);
    });

    it(`should return false when a Schema Registry config's uri does not include "${CCLOUD_BASE_PATH}"`, function () {
      const spec = TEST_DIRECT_CONNECTION_FORM_SPEC;
      spec.schemaRegistry = {
        uri: "https://localhost:443",
      };

      const result = hasCCloudDomain(spec.schemaRegistry);

      assert.strictEqual(result, false);
    });

    it("should return false when no config is provided", function () {
      const result = hasCCloudDomain(undefined);

      assert.strictEqual(result, false);
    });
  });
});
