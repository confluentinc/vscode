import * as assert from "assert";
import { TEST_DIRECT_CONNECTION_FORM_SPEC } from "../../tests/unit/testResources/connection";
import { CCLOUD_DOMAIN_SUBSTRING, hasCCloudDomain } from "./utils";

describe("directConnections/utils.ts", function () {
  describe("hasCCloudDomain()", function () {
    it(`should return true when a Kafka config's bootstrap_servers includes "${CCLOUD_DOMAIN_SUBSTRING}"`, function () {
      const spec = TEST_DIRECT_CONNECTION_FORM_SPEC;
      spec.kafka_cluster = {
        bootstrap_servers: "pkc-123.region.provider.confluent.cloud:9092",
      };

      const result = hasCCloudDomain(spec.kafka_cluster);

      assert.strictEqual(result, true);
    });

    it(`should return false when a Kafka config's bootstrap_servers does not include "${CCLOUD_DOMAIN_SUBSTRING}"`, function () {
      const spec = TEST_DIRECT_CONNECTION_FORM_SPEC;
      spec.kafka_cluster = {
        bootstrap_servers: "localhost:9092",
      };

      const result = hasCCloudDomain(spec.kafka_cluster);

      assert.strictEqual(result, false);
    });

    it(`should return true when a Schema Registry config's uri includes "${CCLOUD_DOMAIN_SUBSTRING}"`, function () {
      const spec = TEST_DIRECT_CONNECTION_FORM_SPEC;
      spec.schema_registry = {
        uri: "https://pkc-123.region.provider.confluent.cloud",
      };

      const result = hasCCloudDomain(spec.schema_registry);

      assert.strictEqual(result, true);
    });

    it(`should return false when a Schema Registry config's uri does not include "${CCLOUD_DOMAIN_SUBSTRING}"`, function () {
      const spec = TEST_DIRECT_CONNECTION_FORM_SPEC;
      spec.schema_registry = {
        uri: "https://localhost:443",
      };

      const result = hasCCloudDomain(spec.schema_registry);

      assert.strictEqual(result, false);
    });

    it("should return false when no config is provided", function () {
      // no Kafka/SR configs by default
      const spec = TEST_DIRECT_CONNECTION_FORM_SPEC;

      const kafkaResult = hasCCloudDomain(spec.kafka_cluster);
      assert.strictEqual(kafkaResult, false);

      const schemaRegistryResult = hasCCloudDomain(spec.schema_registry);
      assert.strictEqual(schemaRegistryResult, false);
    });
  });
});
