import * as assert from "assert";
import * as sinon from "sinon";
import {
  CCloudRecordDeserializer,
  createCCloudRecordDeserializer,
  decodeRawField,
  isRawField,
} from "./ccloudDeserializer";
import { resetErrorCache } from "./errorCache";
import { DataFormat } from "./types";

describe("serde/ccloudDeserializer.ts", function () {
  let sandbox: sinon.SinonSandbox;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    resetErrorCache();
  });

  afterEach(function () {
    sandbox.restore();
    resetErrorCache();
  });

  describe("isRawField()", function () {
    it("should return true for valid __raw__ field", function () {
      const value = { __raw__: "SGVsbG8gV29ybGQ=" }; // "Hello World" in base64
      assert.strictEqual(isRawField(value), true);
    });

    it("should return false for null", function () {
      assert.strictEqual(isRawField(null), false);
    });

    it("should return false for undefined", function () {
      assert.strictEqual(isRawField(undefined), false);
    });

    it("should return false for plain string", function () {
      assert.strictEqual(isRawField("hello"), false);
    });

    it("should return false for number", function () {
      assert.strictEqual(isRawField(123), false);
    });

    it("should return false for object without __raw__", function () {
      assert.strictEqual(isRawField({ foo: "bar" }), false);
    });

    it("should return false for object with non-string __raw__", function () {
      assert.strictEqual(isRawField({ __raw__: 123 }), false);
    });

    it("should return false for array", function () {
      assert.strictEqual(isRawField(["__raw__", "data"]), false);
    });
  });

  describe("decodeRawField()", function () {
    it("should decode base64 to buffer", function () {
      const rawField = { __raw__: "SGVsbG8gV29ybGQ=" }; // "Hello World"
      const buffer = decodeRawField(rawField);
      assert.strictEqual(buffer.toString("utf-8"), "Hello World");
    });

    it("should handle empty base64", function () {
      const rawField = { __raw__: "" };
      const buffer = decodeRawField(rawField);
      assert.strictEqual(buffer.length, 0);
    });

    it("should handle binary data", function () {
      // Binary: 0x00 0x01 0x02 0x03
      const rawField = { __raw__: "AAECAw==" };
      const buffer = decodeRawField(rawField);
      assert.strictEqual(buffer[0], 0x00);
      assert.strictEqual(buffer[1], 0x01);
      assert.strictEqual(buffer[2], 0x02);
      assert.strictEqual(buffer[3], 0x03);
    });
  });

  describe("CCloudRecordDeserializer", function () {
    const testConfig = {
      schemaRegistryUrl: "https://psrc-abc123.us-west-2.aws.confluent.cloud",
      bearerToken: "test-token",
      headers: { "target-sr-cluster": "lsrc-abc123" },
      connectionId: "ccloud-conn-1",
      clusterId: "lkc-abc123",
    };

    describe("deserialize() - non-raw values", function () {
      it("should return null for null value", async function () {
        const deserializer = createCCloudRecordDeserializer(testConfig);
        const result = await deserializer.deserialize(null, {
          topicName: "test-topic",
          isKey: false,
        });

        assert.strictEqual(result.value, null);
        assert.strictEqual(result.metadata.dataFormat, DataFormat.RAW_BYTES);
      });

      it("should return null for undefined value", async function () {
        const deserializer = createCCloudRecordDeserializer(testConfig);
        const result = await deserializer.deserialize(undefined, {
          topicName: "test-topic",
          isKey: false,
        });

        assert.strictEqual(result.value, null);
        assert.strictEqual(result.metadata.dataFormat, DataFormat.RAW_BYTES);
      });

      it("should return already-decoded JSON as-is", async function () {
        const deserializer = createCCloudRecordDeserializer(testConfig);
        const decoded = { name: "test", count: 42 };
        const result = await deserializer.deserialize(decoded, {
          topicName: "test-topic",
          isKey: false,
        });

        assert.deepStrictEqual(result.value, decoded);
        assert.strictEqual(result.metadata.dataFormat, DataFormat.JSON);
      });

      it("should return already-decoded string as-is", async function () {
        const deserializer = createCCloudRecordDeserializer(testConfig);
        const result = await deserializer.deserialize("hello world", {
          topicName: "test-topic",
          isKey: false,
        });

        assert.strictEqual(result.value, "hello world");
        assert.strictEqual(result.metadata.dataFormat, DataFormat.JSON);
      });

      it("should return already-decoded number as-is", async function () {
        const deserializer = createCCloudRecordDeserializer(testConfig);
        const result = await deserializer.deserialize(42, {
          topicName: "test-topic",
          isKey: false,
        });

        assert.strictEqual(result.value, 42);
        assert.strictEqual(result.metadata.dataFormat, DataFormat.JSON);
      });
    });

    describe("deserialize() - __raw__ values without wire format", function () {
      it("should decode __raw__ JSON and return parsed result", async function () {
        const deserializer = createCCloudRecordDeserializer(testConfig);
        // JSON: {"name":"test"}
        const rawField = { __raw__: "eyJuYW1lIjoidGVzdCJ9" };
        const result = await deserializer.deserialize(rawField, {
          topicName: "test-topic",
          isKey: false,
        });

        assert.deepStrictEqual(result.value, { name: "test" });
        assert.strictEqual(result.metadata.dataFormat, DataFormat.JSON);
      });

      it("should decode __raw__ UTF-8 string", async function () {
        const deserializer = createCCloudRecordDeserializer(testConfig);
        // "Hello World"
        const rawField = { __raw__: "SGVsbG8gV29ybGQ=" };
        const result = await deserializer.deserialize(rawField, {
          topicName: "test-topic",
          isKey: false,
        });

        assert.strictEqual(result.value, "Hello World");
        assert.strictEqual(result.metadata.dataFormat, DataFormat.UTF8_STRING);
      });

      it("should return base64 for binary data without wire format", async function () {
        const deserializer = createCCloudRecordDeserializer(testConfig);
        // Binary data starting with 0x01 (not magic byte)
        const rawField = { __raw__: "AQIDBAUGBwgJCg==" };
        const result = await deserializer.deserialize(rawField, {
          topicName: "test-topic",
          isKey: false,
        });

        assert.strictEqual(result.value, "AQIDBAUGBwgJCg==");
        assert.strictEqual(result.metadata.dataFormat, DataFormat.RAW_BYTES);
      });

      it("should return null for empty __raw__ field", async function () {
        const deserializer = createCCloudRecordDeserializer(testConfig);
        const rawField = { __raw__: "" };
        const result = await deserializer.deserialize(rawField, {
          topicName: "test-topic",
          isKey: false,
        });

        assert.strictEqual(result.value, null);
        assert.strictEqual(result.metadata.dataFormat, DataFormat.RAW_BYTES);
      });
    });

    describe("deserialize() - __raw__ values with wire format", function () {
      it("should extract schema ID from wire format header", async function () {
        const deserializer = createCCloudRecordDeserializer(testConfig);

        // Create wire format buffer: magic byte (0x00) + schema ID (123) + payload
        const schemaId = 123;
        const payload = Buffer.from("test payload");
        const wireFormatBuffer = Buffer.alloc(5 + payload.length);
        wireFormatBuffer.writeUInt8(0x00, 0);
        wireFormatBuffer.writeInt32BE(schemaId, 1);
        payload.copy(wireFormatBuffer, 5);

        const rawField = { __raw__: wireFormatBuffer.toString("base64") };
        const result = await deserializer.deserialize(rawField, {
          topicName: "test-topic",
          isKey: false,
        });

        // Should have schema ID in metadata (even if fetch fails)
        assert.strictEqual(result.metadata.schemaId, schemaId);
        // Should have an error since SR is not reachable
        assert.ok(result.errorMessage);
      });

      it("should handle too-short wire format gracefully", async function () {
        const deserializer = createCCloudRecordDeserializer(testConfig);

        // Just magic byte + partial schema ID (5 bytes needed, only 3 provided)
        const shortBuffer = Buffer.from([0x00, 0x00, 0x01]);
        const rawField = { __raw__: shortBuffer.toString("base64") };

        const result = await deserializer.deserialize(rawField, {
          topicName: "test-topic",
          isKey: false,
        });

        // Should not extract schema ID from too-short buffer
        assert.strictEqual(result.metadata.schemaId, undefined);
        // Should use fallback chain
        assert.strictEqual(result.metadata.dataFormat, DataFormat.RAW_BYTES);
      });
    });

    describe("error caching", function () {
      it("should cache and return cached errors", async function () {
        const deserializer = createCCloudRecordDeserializer(testConfig);

        // Create wire format buffer with schema ID 456
        const schemaId = 456;
        const payload = Buffer.from("test");
        const wireFormatBuffer = Buffer.alloc(5 + payload.length);
        wireFormatBuffer.writeUInt8(0x00, 0);
        wireFormatBuffer.writeInt32BE(schemaId, 1);
        payload.copy(wireFormatBuffer, 5);

        const rawField = { __raw__: wireFormatBuffer.toString("base64") };

        // First call - should fail and cache error
        const result1 = await deserializer.deserialize(rawField, {
          topicName: "test-topic",
          isKey: false,
        });
        assert.ok(result1.errorMessage);
        assert.strictEqual(result1.metadata.schemaId, schemaId);

        // Second call - should return cached error
        const result2 = await deserializer.deserialize(rawField, {
          topicName: "test-topic",
          isKey: false,
        });
        assert.ok(result2.errorMessage);
        assert.strictEqual(result2.metadata.schemaId, schemaId);
        // Error messages should be the same
        assert.strictEqual(result2.errorMessage, result1.errorMessage);
      });
    });

    describe("clearCache()", function () {
      it("should clear the schema cache", function () {
        const deserializer = createCCloudRecordDeserializer(testConfig);
        // Just verify the method exists and doesn't throw
        assert.doesNotThrow(() => deserializer.clearCache());
      });
    });
  });

  describe("createCCloudRecordDeserializer()", function () {
    it("should create a deserializer with bearer token auth", function () {
      const config = {
        schemaRegistryUrl: "https://sr.example.com",
        bearerToken: "token123",
        connectionId: "conn-1",
        clusterId: "cluster-1",
      };
      const deserializer = createCCloudRecordDeserializer(config);
      assert.ok(deserializer instanceof CCloudRecordDeserializer);
    });

    it("should create a deserializer with basic auth", function () {
      const config = {
        schemaRegistryUrl: "https://sr.example.com",
        auth: { username: "user", password: "pass" },
        connectionId: "conn-1",
        clusterId: "cluster-1",
      };
      const deserializer = createCCloudRecordDeserializer(config);
      assert.ok(deserializer instanceof CCloudRecordDeserializer);
    });

    it("should create a deserializer with custom headers", function () {
      const config = {
        schemaRegistryUrl: "https://sr.example.com",
        bearerToken: "token123",
        headers: { "target-sr-cluster": "lsrc-123" },
        connectionId: "conn-1",
        clusterId: "cluster-1",
      };
      const deserializer = createCCloudRecordDeserializer(config);
      assert.ok(deserializer instanceof CCloudRecordDeserializer);
    });
  });
});
