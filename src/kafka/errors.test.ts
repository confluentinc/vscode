import * as assert from "assert";
import { KafkaAdminError, KafkaAdminErrorCategory } from "./errors";

describe("kafka/errors", function () {
  describe("KafkaAdminErrorCategory", function () {
    it("should have all expected categories", function () {
      assert.strictEqual(KafkaAdminErrorCategory.TRANSIENT, "TRANSIENT");
      assert.strictEqual(KafkaAdminErrorCategory.AUTH, "AUTH");
      assert.strictEqual(KafkaAdminErrorCategory.INVALID, "INVALID");
      assert.strictEqual(KafkaAdminErrorCategory.NOT_FOUND, "NOT_FOUND");
      assert.strictEqual(KafkaAdminErrorCategory.ALREADY_EXISTS, "ALREADY_EXISTS");
      assert.strictEqual(KafkaAdminErrorCategory.UNKNOWN, "UNKNOWN");
    });
  });

  describe("KafkaAdminError", function () {
    it("should create error with message and category", function () {
      const error = new KafkaAdminError("test error", KafkaAdminErrorCategory.TRANSIENT);
      assert.strictEqual(error.message, "test error");
      assert.strictEqual(error.category, KafkaAdminErrorCategory.TRANSIENT);
      assert.strictEqual(error.name, "KafkaAdminError");
    });

    it("should set retryable true for TRANSIENT by default", function () {
      const error = new KafkaAdminError("test", KafkaAdminErrorCategory.TRANSIENT);
      assert.strictEqual(error.retryable, true);
    });

    it("should set retryable false for non-TRANSIENT by default", function () {
      const authError = new KafkaAdminError("test", KafkaAdminErrorCategory.AUTH);
      assert.strictEqual(authError.retryable, false);

      const invalidError = new KafkaAdminError("test", KafkaAdminErrorCategory.INVALID);
      assert.strictEqual(invalidError.retryable, false);

      const notFoundError = new KafkaAdminError("test", KafkaAdminErrorCategory.NOT_FOUND);
      assert.strictEqual(notFoundError.retryable, false);
    });

    it("should allow overriding retryable", function () {
      const error = new KafkaAdminError("test", KafkaAdminErrorCategory.UNKNOWN, {
        retryable: true,
      });
      assert.strictEqual(error.retryable, true);
    });

    it("should store cause error", function () {
      const cause = new Error("original error");
      const error = new KafkaAdminError("wrapped", KafkaAdminErrorCategory.UNKNOWN, { cause });
      assert.strictEqual(error.cause, cause);
    });
  });

  describe("KafkaAdminError.fromKafkaJsError", function () {
    it("should classify authentication errors", function () {
      const authError = new Error("SASL authentication failed");
      const wrapped = KafkaAdminError.fromKafkaJsError(authError);
      assert.strictEqual(wrapped.category, KafkaAdminErrorCategory.AUTH);
    });

    it("should classify authorization errors", function () {
      const authzError = new Error("Not authorized to access topic");
      const wrapped = KafkaAdminError.fromKafkaJsError(authzError);
      assert.strictEqual(wrapped.category, KafkaAdminErrorCategory.AUTH);
    });

    it("should classify unknown topic errors", function () {
      const topicError = new Error("Unknown topic or partition");
      const wrapped = KafkaAdminError.fromKafkaJsError(topicError);
      assert.strictEqual(wrapped.category, KafkaAdminErrorCategory.NOT_FOUND);
    });

    it("should classify already exists errors", function () {
      const existsError = new Error("Topic with this name already exists");
      const wrapped = KafkaAdminError.fromKafkaJsError(existsError);
      assert.strictEqual(wrapped.category, KafkaAdminErrorCategory.ALREADY_EXISTS);
    });

    it("should classify connection errors as TRANSIENT", function () {
      const connectionError = new Error("Connection timeout");
      connectionError.name = "KafkaJSConnectionError";
      const wrapped = KafkaAdminError.fromKafkaJsError(connectionError);
      assert.strictEqual(wrapped.category, KafkaAdminErrorCategory.TRANSIENT);
    });

    it("should classify broker errors as TRANSIENT", function () {
      const brokerError = new Error("Broker not available");
      const wrapped = KafkaAdminError.fromKafkaJsError(brokerError);
      assert.strictEqual(wrapped.category, KafkaAdminErrorCategory.TRANSIENT);
    });

    it("should classify invalid topic errors", function () {
      const invalidError = new Error("Invalid topic name");
      const wrapped = KafkaAdminError.fromKafkaJsError(invalidError);
      assert.strictEqual(wrapped.category, KafkaAdminErrorCategory.INVALID);
    });

    it("should default to UNKNOWN for unrecognized errors", function () {
      const unknownError = new Error("Some random error");
      const wrapped = KafkaAdminError.fromKafkaJsError(unknownError);
      assert.strictEqual(wrapped.category, KafkaAdminErrorCategory.UNKNOWN);
    });

    it("should preserve original error as cause", function () {
      const original = new Error("original");
      const wrapped = KafkaAdminError.fromKafkaJsError(original);
      assert.strictEqual(wrapped.cause, original);
    });
  });
});
