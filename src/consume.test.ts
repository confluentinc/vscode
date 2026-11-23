import * as assert from "assert";
import { proxyTimeoutBody } from "../tests/unit/testUtils";
import { consumeErrorMessage } from "./consume";

describe("consume.ts consumeErrorMessage()", () => {
  it("should say which host timed out for a sidecar proxy timeout", () => {
    const title = "pkc-123.confluent.cloud didn't respond within 60s";

    const message = consumeErrorMessage(504, proxyTimeoutBody(title));

    assert.strictEqual(message, `${title}. Try again.`);
  });

  it("should name the Kafka cluster for a 504 without a proxy timeout body", () => {
    const message = consumeErrorMessage(504, {});

    assert.strictEqual(message, "Timed out waiting for the Kafka cluster. Try again.");
  });

  it("should keep the messages for the other expected statuses", () => {
    const messages = [
      consumeErrorMessage(401, {}),
      consumeErrorMessage(403, {}),
      consumeErrorMessage(404, { title: "Error fetching the messages from topic" }),
      consumeErrorMessage(404, {}),
      consumeErrorMessage(429, {}),
    ];

    assert.deepStrictEqual(messages, [
      "Authentication required.",
      "Insufficient permissions to read from topic.",
      "Topic not found.",
      "Unable to connect to the server.",
      "Too many requests. Try again later.",
    ]);
  });

  it("should leave an unexpected status to the caller", () => {
    const message = consumeErrorMessage(500, {});

    assert.strictEqual(message, undefined);
  });
});
