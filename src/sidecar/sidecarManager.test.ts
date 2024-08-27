import * as assert from "assert";
import "mocha";
import { SIDECAR_LOGFILE_PATH, constructSidecarEnv, wasConnRefused } from "./sidecarManager";

describe("Test wasConnRefused", () => {
  it("wasConnRefused() should return true for various spellings of a connection refused error", () => {
    const connRefusedErrors = [
      { code: "ECONNREFUSED" },
      { cause: { code: "ECONNREFUSED" } },
      { cause: { cause: { code: "ECONNREFUSED" } } },
      { cause: { cause: { errors: [{ code: "ECONNREFUSED" }] } } },
    ];

    for (const error of connRefusedErrors) {
      assert.strictEqual(true, wasConnRefused(error));
    }
  });

  it("wasConnRefused() should return false for non-connection-refused errors", () => {
    const nonConnRefusedErrors = [
      {},
      null,
      { code: "ECONNRESET" },
      { cause: { code: "ECONNRESET" } },
      { cause: { cause: { code: "ECONNRESET" } } },
      { cause: { cause: { errors: [{ blah: false }] } } },
    ];

    for (const error of nonConnRefusedErrors) {
      assert.strictEqual(false, wasConnRefused(error));
    }
  });
});

describe("constructSidecarEnv tests", () => {
  it("Will set QUARKUS_HTTP_HOST if env indicates WSL", () => {
    const env = { WSL_DISTRO_NAME: "Ubuntu" };
    const result = constructSidecarEnv(env);
    assert.strictEqual(result.QUARKUS_HTTP_HOST, "0.0.0.0");
  });

  it("Will not set QUARKUS_HTTP_HOST if env does not indicate WSL", () => {
    const env = {};
    const result = constructSidecarEnv(env);
    assert.strictEqual(result.QUARKUS_HTTP_HOST, undefined);
  });

  it("Sets logging env vars as expected", () => {
    const env = {};
    const result = constructSidecarEnv(env);
    assert.strictEqual(result.QUARKUS_LOG_FILE_ENABLE, "true");
    assert.strictEqual(result.QUARKUS_LOG_FILE_ROTATION_ROTATE_ON_BOOT, "false");
    assert.strictEqual(result.QUARKUS_LOG_FILE_PATH, SIDECAR_LOGFILE_PATH);
  });

  it("Other preset env vars are set as expected", () => {
    const env = { FOO: "bar" };
    const result = constructSidecarEnv(env);
    assert.strictEqual("bar", result.FOO);
  });
});
