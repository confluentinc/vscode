import assert from "assert";
import { extractPageToken } from "./utils";

describe("flinkSql/utils", () => {
  describe("extractPageToken", () => {
    it("should return undefined when nextUrl is undefined", () => {
      const result = extractPageToken(undefined);
      assert.strictEqual(result, undefined);
    });

    it("should return undefined when page_token parameter is missing", () => {
      const result = extractPageToken("https://example.com/path?foo=bar&baz=qux");
      assert.strictEqual(result, undefined);
    });

    it("should return undefined for an invalid URL string", () => {
      const result = extractPageToken("not a valid url");
      assert.strictEqual(result, undefined);
    });

    it("should extract page_token when it is a query parameter", () => {
      const result = extractPageToken("https://example.com/path?page_token=abc123");
      assert.strictEqual(result, "abc123");
    });
  });
});
