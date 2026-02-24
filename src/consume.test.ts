import { deepEqual, equal, strictEqual } from "node:assert/strict";
import type { PartitionConsumeRecord } from "./clients/sidecar";
import {
  getOffsets,
  getParams,
  getTextFilterParams,
  MessageViewerConfig,
  prepare,
  truncate,
} from "./consume";

describe("consume", () => {
  describe("getParams", () => {
    it("should return from_beginning for 'beginning' mode", () => {
      const result = getParams("beginning", undefined, 500);
      strictEqual(result.from_beginning, true);
      strictEqual(result.max_poll_records, 500);
      strictEqual(result.timestamp, undefined);
    });

    it("should return default params for 'latest' mode", () => {
      const result = getParams("latest", undefined, 500);
      strictEqual(result.from_beginning, undefined);
      strictEqual(result.timestamp, undefined);
      strictEqual(result.max_poll_records, 500);
    });

    it("should include timestamp for 'timestamp' mode", () => {
      const ts = 1700000000000;
      const result = getParams("timestamp", ts, 100);
      strictEqual(result.timestamp, ts);
      strictEqual(result.max_poll_records, 100);
      strictEqual(result.from_beginning, undefined);
    });

    it("should respect max_poll_records parameter", () => {
      const result = getParams("beginning", undefined, 42);
      strictEqual(result.max_poll_records, 42);
    });
  });

  describe("getTextFilterParams", () => {
    it("should return a bitset of the given capacity", () => {
      const { bitset } = getTextFilterParams("test", 1000);
      strictEqual(bitset.capacity, 1000);
    });

    it("should escape regex special characters", () => {
      const { regexp } = getTextFilterParams("price$10.00", 100);
      // the dollar sign and dots should be escaped
      equal(regexp.test("price$10.00"), true);
      equal(regexp.test("price$10X00"), false);
    });

    it("should make whitespace optional in the pattern", () => {
      const { regexp } = getTextFilterParams("hello world", 100);
      equal(regexp.test("helloworld"), true);
      equal(regexp.test("hello   world"), true);
      equal(regexp.test("hello world"), true);
    });

    it("should be case-insensitive", () => {
      const { regexp } = getTextFilterParams("Hello", 100);
      equal(regexp.test("hello"), true);
      equal(regexp.test("HELLO"), true);
    });

    it("should preserve the original query string", () => {
      const { query } = getTextFilterParams("  test  ", 100);
      strictEqual(query, "  test  ");
    });
  });

  describe("getOffsets", () => {
    const baseParams = {
      max_poll_records: 500,
      message_max_bytes: 1024 * 1024,
      fetch_max_bytes: 40 * 1024 * 1024,
    };

    it("should return original params when results is null", () => {
      const result = getOffsets(baseParams, null, null);
      strictEqual(result, baseParams);
    });

    it("should return original params when partition_data_list is undefined", () => {
      const result = getOffsets(baseParams, {}, null);
      strictEqual(result, baseParams);
    });

    it("should compute offsets from partition data", () => {
      const results = {
        partition_data_list: [
          { partition_id: 0, next_offset: 10 },
          { partition_id: 1, next_offset: 20 },
        ],
      };
      const result = getOffsets(baseParams, results, null);
      deepEqual(result.offsets, [
        { partition_id: 0, offset: 10 },
        { partition_id: 1, offset: 20 },
      ]);
      strictEqual(result.max_poll_records, 500);
    });

    it("should filter offsets by partition list", () => {
      const results = {
        partition_data_list: [
          { partition_id: 0, next_offset: 10 },
          { partition_id: 1, next_offset: 20 },
          { partition_id: 2, next_offset: 30 },
        ],
      };
      const result = getOffsets(baseParams, results, [0, 2]);
      deepEqual(result.offsets, [
        { partition_id: 0, offset: 10 },
        { partition_id: 2, offset: 30 },
      ]);
    });
  });

  describe("truncate", () => {
    it("should return null for null input", () => {
      strictEqual(truncate(null), null);
    });

    it("should return undefined for undefined input", () => {
      strictEqual(truncate(undefined), null);
    });

    it("should return short strings unchanged", () => {
      strictEqual(truncate("hello"), "hello");
    });

    it("should return numbers unchanged", () => {
      strictEqual(truncate(42), 42);
    });

    it("should stringify objects", () => {
      const result = truncate({ a: 1 });
      strictEqual(typeof result, "string");
      equal(result.includes('"a"'), true);
    });

    it("should truncate strings over 1024 characters", () => {
      const long = "x".repeat(2000);
      const result = truncate(long);
      strictEqual(typeof result, "string");
      equal(result.includes("..."), true);
      strictEqual(result.length, 517); // 256 + separator (5) + 256
    });

    it("should not truncate strings at exactly 1024 characters", () => {
      const exact = "x".repeat(1024);
      strictEqual(truncate(exact), exact);
    });
  });

  describe("prepare", () => {
    const baseMessage: PartitionConsumeRecord = {
      partition_id: 0,
      offset: 42,
      timestamp: 1700000000000,
      headers: [{ key: "h1", value: "v1" }],
      key: '{"id": 1}' as unknown as PartitionConsumeRecord["key"],
      value: '{"name": "test"}' as unknown as PartitionConsumeRecord["value"],
    };

    it("should parse key and value JSON when serialized flags are true", () => {
      const result = prepare(baseMessage, true, true);
      deepEqual(result.key, { id: 1 });
      deepEqual(result.value, { name: "test" });
    });

    it("should leave key and value as-is when serialized flags are false", () => {
      const result = prepare(baseMessage, false, false);
      strictEqual(result.key, '{"id": 1}');
      strictEqual(result.value, '{"name": "test"}');
    });

    it("should handle invalid JSON gracefully", () => {
      const msg = {
        ...baseMessage,
        key: "not-json{" as unknown as PartitionConsumeRecord["key"],
        value: "also-not{json" as unknown as PartitionConsumeRecord["value"],
      };
      const result = prepare(msg, true, true);
      strictEqual(result.key, "not-json{");
      strictEqual(result.value, "also-not{json");
    });

    it("should pass through metadata fields", () => {
      const result = prepare(baseMessage, false, false);
      strictEqual(result.partition_id, 0);
      strictEqual(result.offset, 42);
      strictEqual(result.timestamp, 1700000000000);
      deepEqual(result.headers, [{ key: "h1", value: "v1" }]);
    });
  });

  describe("MessageViewerConfig", () => {
    describe("fromQuery", () => {
      it("should parse valid consumeMode", () => {
        const params = new URLSearchParams({ consumeMode: "latest" });
        const config = MessageViewerConfig.fromQuery(params);
        strictEqual(config.consumeMode, "latest");
      });

      it("should ignore invalid consumeMode and use default", () => {
        const params = new URLSearchParams({ consumeMode: "invalid" });
        const config = MessageViewerConfig.fromQuery(params);
        strictEqual(config.consumeMode, "beginning");
      });

      it("should parse consumeTimestamp as integer", () => {
        const params = new URLSearchParams({ consumeTimestamp: "1700000000000" });
        const config = MessageViewerConfig.fromQuery(params);
        strictEqual(config.consumeTimestamp, 1700000000000);
      });

      it("should ignore non-numeric consumeTimestamp", () => {
        const params = new URLSearchParams({ consumeTimestamp: "not-a-number" });
        const config = MessageViewerConfig.fromQuery(params);
        strictEqual(config.consumeTimestamp, null);
      });

      it("should parse partitionConsumed as number array", () => {
        const params = new URLSearchParams({ partitionConsumed: "0,1,2" });
        const config = MessageViewerConfig.fromQuery(params);
        deepEqual(config.partitionConsumed, [0, 1, 2]);
      });

      it("should validate messageLimit against allowed values", () => {
        const params = new URLSearchParams({ messageLimit: "10000" });
        const config = MessageViewerConfig.fromQuery(params);
        strictEqual(config.messageLimit, 10_000);
      });

      it("should reject messageLimit with non-allowed values", () => {
        const params = new URLSearchParams({ messageLimit: "500" });
        const config = MessageViewerConfig.fromQuery(params);
        strictEqual(config.messageLimit, 100_000); // default
      });

      it("should parse timestampFilter as two-element array", () => {
        const params = new URLSearchParams({ timestampFilter: "1000,2000" });
        const config = MessageViewerConfig.fromQuery(params);
        deepEqual(config.timestampFilter, [1000, 2000]);
      });

      it("should reject timestampFilter with wrong number of elements", () => {
        const params = new URLSearchParams({ timestampFilter: "1000" });
        const config = MessageViewerConfig.fromQuery(params);
        strictEqual(config.timestampFilter, null);
      });

      it("should parse textFilter", () => {
        const params = new URLSearchParams({ textFilter: "search term" });
        const config = MessageViewerConfig.fromQuery(params);
        strictEqual(config.textFilter, "search term");
      });

      it("should return defaults for empty params", () => {
        const config = MessageViewerConfig.fromQuery(new URLSearchParams());
        strictEqual(config.consumeMode, "beginning");
        strictEqual(config.consumeTimestamp, null);
        strictEqual(config.partitionConsumed, null);
        strictEqual(config.messageLimit, 100_000);
        strictEqual(config.partitionFilter, null);
        strictEqual(config.timestampFilter, null);
        strictEqual(config.textFilter, null);
      });
    });

    describe("toQuery", () => {
      it("should omit null values", () => {
        const config = MessageViewerConfig.create();
        const params = config.toQuery();
        strictEqual(params.has("consumeTimestamp"), false);
        strictEqual(params.has("partitionConsumed"), false);
      });

      it("should include non-null values", () => {
        const config = MessageViewerConfig.create({ consumeMode: "latest", messageLimit: 1000 });
        const params = config.toQuery();
        strictEqual(params.get("consumeMode"), "latest");
        strictEqual(params.get("messageLimit"), "1000");
      });

      it("should round-trip through fromQuery for key fields", () => {
        const original = MessageViewerConfig.create({
          consumeMode: "timestamp",
          consumeTimestamp: 1700000000000,
          messageLimit: 10_000,
          textFilter: "hello",
        });
        const restored = MessageViewerConfig.fromQuery(original.toQuery());
        strictEqual(restored.consumeMode, original.consumeMode);
        strictEqual(restored.consumeTimestamp, original.consumeTimestamp);
        strictEqual(restored.messageLimit, original.messageLimit);
        strictEqual(restored.textFilter, original.textFilter);
      });
    });
  });
});
