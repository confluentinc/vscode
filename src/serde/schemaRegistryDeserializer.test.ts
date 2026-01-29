import * as assert from "assert";
import * as sinon from "sinon";
import {
  createFallbackDeserializer,
  createSchemaRegistryDeserializer,
} from "./schemaRegistryDeserializer";
import { resetErrorCache } from "./errorCache";
import { DataFormat } from "./types";

describe("serde/schemaRegistryDeserializer.ts", function () {
  beforeEach(function () {
    resetErrorCache();
  });

  afterEach(function () {
    sinon.restore();
    resetErrorCache();
  });

  describe("createFallbackDeserializer()", function () {
    it("should return null for null buffer", async function () {
      const deserializer = createFallbackDeserializer();
      const result = await deserializer.deserialize(null, { topicName: "test", isKey: false });

      assert.strictEqual(result.value, null);
      assert.strictEqual(result.metadata.dataFormat, DataFormat.RAW_BYTES);
    });

    it("should return null for empty buffer", async function () {
      const deserializer = createFallbackDeserializer();
      const result = await deserializer.deserialize(Buffer.from([]), {
        topicName: "test",
        isKey: false,
      });

      assert.strictEqual(result.value, null);
      assert.strictEqual(result.metadata.dataFormat, DataFormat.RAW_BYTES);
    });

    it("should parse valid JSON", async function () {
      const deserializer = createFallbackDeserializer();
      const json = { name: "test", value: 123 };
      const result = await deserializer.deserialize(Buffer.from(JSON.stringify(json)), {
        topicName: "test",
        isKey: false,
      });

      assert.deepStrictEqual(result.value, json);
      assert.strictEqual(result.metadata.dataFormat, DataFormat.JSON);
    });

    it("should return UTF-8 string for non-JSON text", async function () {
      const deserializer = createFallbackDeserializer();
      const text = "Hello, World!";
      const result = await deserializer.deserialize(Buffer.from(text), {
        topicName: "test",
        isKey: false,
      });

      assert.strictEqual(result.value, text);
      assert.strictEqual(result.metadata.dataFormat, DataFormat.UTF8_STRING);
    });

    it("should return base64 for binary data", async function () {
      const deserializer = createFallbackDeserializer();
      // Binary data with null bytes
      const binaryData = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe]);
      const result = await deserializer.deserialize(binaryData, {
        topicName: "test",
        isKey: false,
      });

      // Should be base64 encoded
      assert.strictEqual(result.value, binaryData.toString("base64"));
      assert.strictEqual(result.metadata.dataFormat, DataFormat.RAW_BYTES);
    });
  });

  describe("createSchemaRegistryDeserializer()", function () {
    it("should return null for null buffer", async function () {
      const deserializer = createSchemaRegistryDeserializer({
        schemaRegistryUrl: "http://localhost:8081",
        connectionId: "conn-1",
        clusterId: "cluster-1",
      });

      const result = await deserializer.deserialize(null, { topicName: "test", isKey: false });

      assert.strictEqual(result.value, null);
      assert.strictEqual(result.metadata.dataFormat, DataFormat.RAW_BYTES);
    });

    it("should use fallback chain for non-wire-format messages", async function () {
      const deserializer = createSchemaRegistryDeserializer({
        schemaRegistryUrl: "http://localhost:8081",
        connectionId: "conn-1",
        clusterId: "cluster-1",
      });

      // JSON without wire format magic byte
      const json = { test: "data" };
      const result = await deserializer.deserialize(Buffer.from(JSON.stringify(json)), {
        topicName: "test",
        isKey: false,
      });

      assert.deepStrictEqual(result.value, json);
      assert.strictEqual(result.metadata.dataFormat, DataFormat.JSON);
      assert.strictEqual(result.metadata.schemaId, undefined);
    });

    it("should detect wire format but use fallback if too short", async function () {
      const deserializer = createSchemaRegistryDeserializer({
        schemaRegistryUrl: "http://localhost:8081",
        connectionId: "conn-1",
        clusterId: "cluster-1",
      });

      // Just the magic byte, too short for valid wire format
      const result = await deserializer.deserialize(Buffer.from([0x00]), {
        topicName: "test",
        isKey: false,
      });

      // Should fall back since buffer is too short for wire format
      assert.strictEqual(result.metadata.schemaId, undefined);
    });

    it("should extract schema ID from wire format header", async function () {
      const deserializer = createSchemaRegistryDeserializer({
        schemaRegistryUrl: "http://localhost:8081",
        connectionId: "conn-1",
        clusterId: "cluster-1",
      });

      // Create wire format buffer: magic byte (0x00) + schema ID (123) + some payload
      const schemaId = 123;
      const buffer = Buffer.alloc(10);
      buffer.writeUInt8(0x00, 0); // Magic byte
      buffer.writeInt32BE(schemaId, 1); // Schema ID
      buffer.write("test", 5); // Payload

      // This will try to contact Schema Registry which won't be available
      // So it should fall back and include the schema ID in error
      const result = await deserializer.deserialize(buffer, {
        topicName: "test",
        isKey: false,
      });

      // Should have extracted the schema ID even if decode failed
      assert.strictEqual(result.metadata.schemaId, schemaId);
      // Should have an error message since SR is not available
      assert.ok(result.errorMessage);
    });
  });

  describe("wire format detection", function () {
    it("should not detect wire format without magic byte", async function () {
      const deserializer = createFallbackDeserializer();

      // Regular text starting with 'H' (0x48)
      const result = await deserializer.deserialize(Buffer.from("Hello"), {
        topicName: "test",
        isKey: false,
      });

      assert.strictEqual(result.metadata.dataFormat, DataFormat.UTF8_STRING);
      assert.strictEqual(result.metadata.schemaId, undefined);
    });
  });
});
