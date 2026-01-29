import * as assert from "assert";
import { getErrorCache, resetErrorCache } from "./errorCache";

describe("serde/errorCache.ts ErrorCache", function () {
  beforeEach(function () {
    resetErrorCache();
  });

  afterEach(function () {
    resetErrorCache();
  });

  describe("getError()", function () {
    it("should return null for uncached schema ID", function () {
      const cache = getErrorCache();
      const result = cache.getError("conn-1", 123);
      assert.strictEqual(result, null);
    });

    it("should return cached error message", function () {
      const cache = getErrorCache();
      cache.setError("conn-1", 123, "Schema not found");
      const result = cache.getError("conn-1", 123);
      assert.strictEqual(result, "Schema not found");
    });

    it("should isolate errors by connection ID", function () {
      const cache = getErrorCache();
      cache.setError("conn-1", 123, "Error for conn-1");
      cache.setError("conn-2", 123, "Error for conn-2");

      assert.strictEqual(cache.getError("conn-1", 123), "Error for conn-1");
      assert.strictEqual(cache.getError("conn-2", 123), "Error for conn-2");
    });

    it("should isolate errors by schema ID", function () {
      const cache = getErrorCache();
      cache.setError("conn-1", 100, "Error for 100");
      cache.setError("conn-1", 200, "Error for 200");

      assert.strictEqual(cache.getError("conn-1", 100), "Error for 100");
      assert.strictEqual(cache.getError("conn-1", 200), "Error for 200");
    });
  });

  describe("setError()", function () {
    it("should overwrite existing error", function () {
      const cache = getErrorCache();
      cache.setError("conn-1", 123, "First error");
      cache.setError("conn-1", 123, "Second error");

      assert.strictEqual(cache.getError("conn-1", 123), "Second error");
    });
  });

  describe("clearConnection()", function () {
    it("should clear all errors for a connection", function () {
      const cache = getErrorCache();
      cache.setError("conn-1", 100, "Error 100");
      cache.setError("conn-1", 200, "Error 200");
      cache.setError("conn-2", 100, "Other error");

      cache.clearConnection("conn-1");

      assert.strictEqual(cache.getError("conn-1", 100), null);
      assert.strictEqual(cache.getError("conn-1", 200), null);
      assert.strictEqual(cache.getError("conn-2", 100), "Other error");
    });
  });

  describe("clear()", function () {
    it("should clear all errors", function () {
      const cache = getErrorCache();
      cache.setError("conn-1", 100, "Error 1");
      cache.setError("conn-2", 200, "Error 2");

      cache.clear();

      assert.strictEqual(cache.getError("conn-1", 100), null);
      assert.strictEqual(cache.getError("conn-2", 200), null);
    });
  });

  describe("singleton behavior", function () {
    it("should return the same instance", function () {
      const cache1 = getErrorCache();
      const cache2 = getErrorCache();
      assert.strictEqual(cache1, cache2);
    });

    it("should persist data across getInstance calls", function () {
      getErrorCache().setError("conn-1", 123, "Test error");
      assert.strictEqual(getErrorCache().getError("conn-1", 123), "Test error");
    });
  });
});
