import * as assert from "assert";
import { TopicFetchError, SchemaFetchError } from "./types";

describe("fetchers/types", function () {
  describe("TopicFetchError", function () {
    it("should have correct name", function () {
      const error = new TopicFetchError("test message");
      assert.strictEqual(error.name, "TopicFetchError");
    });

    it("should have correct message", function () {
      const error = new TopicFetchError("test message");
      assert.strictEqual(error.message, "test message");
    });

    it("should be instance of Error", function () {
      const error = new TopicFetchError("test message");
      assert.ok(error instanceof Error);
    });
  });

  describe("SchemaFetchError", function () {
    it("should have correct name", function () {
      const error = new SchemaFetchError("test message");
      assert.strictEqual(error.name, "SchemaFetchError");
    });

    it("should have correct message", function () {
      const error = new SchemaFetchError("test message");
      assert.strictEqual(error.message, "test message");
    });

    it("should be instance of Error", function () {
      const error = new SchemaFetchError("test message");
      assert.ok(error instanceof Error);
    });
  });
});
