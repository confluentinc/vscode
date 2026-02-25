import assert from "assert";
import {
  extractWarnings,
  parseLegacyWarnings,
  stripWarningsFromDetail,
  type StatementWarning,
} from "./warningParser";

describe("flinkSql/warningParser", () => {
  describe("parseLegacyWarnings", () => {
    it("should return empty array for undefined input", () => {
      const result = parseLegacyWarnings(undefined);
      assert.deepStrictEqual(result, []);
    });

    it("should return empty array for empty string", () => {
      const result = parseLegacyWarnings("");
      assert.deepStrictEqual(result, []);
    });

    it("should return empty array when no [Warning] markers present", () => {
      const result = parseLegacyWarnings("Statement is running successfully.");
      assert.deepStrictEqual(result, []);
    });

    it("should parse a single legacy warning", () => {
      const result = parseLegacyWarnings(
        "[Warning] The primary key does not match the upsert key.",
      );

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].severity, "MODERATE");
      assert.strictEqual(result[0].reason, "");
      assert.strictEqual(result[0].message, "The primary key does not match the upsert key.");
      // created_at is empty string for legacy warnings (no timestamp available)
      assert.strictEqual(result[0].created_at, "");
    });

    it("should parse multiple legacy warnings", () => {
      const detail =
        "[Warning] First warning message. [Warning] Second warning message with more details.";
      const result = parseLegacyWarnings(detail);

      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].message, "First warning message.");
      assert.strictEqual(result[1].message, "Second warning message with more details.");
    });

    it("should handle real-world legacy warning format", () => {
      const detail =
        "[Warning] The primary key does not match the upsert key derived from the query. " +
        "If the primary key and upsert key don't match, the system needs to add a state-intensive " +
        "operation for correction. [Warning] Your query includes one or more highly state-intensive " +
        "operators but does not set a time-to-live (TTL) value.";

      const result = parseLegacyWarnings(detail);

      assert.strictEqual(result.length, 2);
      assert.ok(result[0].message.includes("primary key does not match"));
      assert.ok(result[1].message.includes("state-intensive operators"));
    });

    it("should handle case-insensitive [Warning] markers", () => {
      const result = parseLegacyWarnings("[warning] lowercase warning message.");

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].message, "lowercase warning message.");
    });

    it("should handle brackets within warning messages", () => {
      const detail =
        "[Warning] Please revisit the query (upsert key: [customer_name]) or provide a primary key.";
      const result = parseLegacyWarnings(detail);

      assert.strictEqual(result.length, 1);
      assert.ok(result[0].message.includes("[customer_name]"));
    });
  });

  describe("extractWarnings", () => {
    it("should return empty array when both inputs are undefined", () => {
      const result = extractWarnings(undefined, undefined);
      assert.deepStrictEqual(result, []);
    });

    it("should prefer structured warnings when available", () => {
      const apiWarnings: StatementWarning[] = [
        {
          severity: "CRITICAL",
          created_at: "2025-11-14T16:01:00Z",
          reason: "UPSERT_PRIMARY_KEY_MISMATCH",
          message: "API warning message",
        },
      ];
      const detail = "[Warning] Legacy warning message.";

      const result = extractWarnings(apiWarnings, detail);

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].message, "API warning message");
      assert.strictEqual(result[0].severity, "CRITICAL");
    });

    it("should fall back to legacy parsing when structured warnings empty", () => {
      const result = extractWarnings([], "[Warning] Legacy warning.");

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].message, "Legacy warning.");
    });

    it("should fall back to legacy parsing when structured warnings undefined", () => {
      const result = extractWarnings(undefined, "[Warning] Legacy warning.");

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].message, "Legacy warning.");
    });

    it("should return empty array when detail has no warnings", () => {
      const result = extractWarnings(undefined, "Statement running successfully.");
      assert.deepStrictEqual(result, []);
    });
  });

  describe("stripWarningsFromDetail", () => {
    it("should return null for undefined input", () => {
      const result = stripWarningsFromDetail(undefined);
      assert.strictEqual(result, null);
    });

    it("should return null when detail contains only warnings", () => {
      const result = stripWarningsFromDetail("[Warning] First. [Warning] Second.");
      assert.strictEqual(result, null);
    });

    it("should preserve non-warning content before warnings", () => {
      const detail = "Statement running. [Warning] Some warning message.";
      const result = stripWarningsFromDetail(detail);
      assert.strictEqual(result, "Statement running.");
    });

    it("should handle detail with no warnings", () => {
      const detail = "Statement completed successfully.";
      const result = stripWarningsFromDetail(detail);
      assert.strictEqual(result, "Statement completed successfully.");
    });
  });
});
