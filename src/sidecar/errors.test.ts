import * as assert from "assert";
import { proxyTimeoutBody } from "../../tests/unit/testUtils";
import { sidecarTimeoutMessage } from "./errors";

const TITLE = "pkc-123.us-east-2.aws.confluent.cloud didn't respond within 20s";
const TARGET = "the Kafka cluster";

describe("sidecar/errors.ts sidecarTimeoutMessage()", () => {
  it("should use the sidecar's title for a proxy timeout", () => {
    const message = sidecarTimeoutMessage(504, proxyTimeoutBody(TITLE), TARGET);

    assert.strictEqual(message, TITLE);
  });

  it("should recognize a proxy timeout by its error code, whatever the status", () => {
    const message = sidecarTimeoutMessage(500, proxyTimeoutBody(TITLE), TARGET);

    assert.strictEqual(message, TITLE);
  });

  it("should name the target for a 504 without a proxy timeout body", () => {
    const message = sidecarTimeoutMessage(504, { message: "Gateway Timeout" }, TARGET);

    assert.strictEqual(message, "Timed out waiting for the Kafka cluster");
  });

  it("should name the target for a 504 with no body", () => {
    const message = sidecarTimeoutMessage(504, undefined, TARGET);

    assert.strictEqual(message, "Timed out waiting for the Kafka cluster");
  });

  it("should leave other errors alone", () => {
    const body = { title: "Something broke", errors: [{ code: "proxy_error" }] };

    const message = sidecarTimeoutMessage(500, body, TARGET);

    assert.strictEqual(message, undefined);
  });
});
