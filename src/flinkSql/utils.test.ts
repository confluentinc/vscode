import assert from "assert";
import { extractPageToken, findFlinkDatabases } from "./utils";

describe("flinkSql/utils", () => {
  describe("findFlinkDatabases", () => {
    it("should throw an error when no Flink-capable databases are found", () => {
      const mockEnvironment = {
        id: "env-123",
        kafkaClusters: [
          {
            id: "cluster-1",
            name: "Non-Flink Cluster",
            // This cluster does not have isFlinkable method
          },
          {
            id: "cluster-2",
            name: "Another Non-Flink Cluster",
            // This cluster also does not have isFlinkable method
          },
        ],
      } as any; // Cast to any to bypass type checking for the test

      assert.throws(() => {
        findFlinkDatabases(mockEnvironment);
      }, /No Flink-capable databases found in environment env-123/);
    });
    it("should return Flink-capable databases when found", () => {
      const mockEnvironment = {
        id: "env-456",
        kafkaClusters: [
          {
            id: "cluster-1",
            name: "Flink Cluster",
            isFlinkable: () => true,
          },
          {
            id: "cluster-2",
            name: "Non-Flink Cluster",
            isFlinkable: () => false,
          },
        ],
      } as any; // Cast to any to bypass type checking for the test

      const result = findFlinkDatabases(mockEnvironment);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].id, "cluster-1");
    });
  });
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
