import * as assert from "assert";
import "mocha";
import { SIDECAR_LOGFILE_PATH } from "./constants";
import { constructSidecarEnv, wasConnRefused, killSidecar } from "./sidecarManager";

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

describe("killSidecar() tests", () => {
  let kill: (pid: number, signal?: string | number | undefined) => true;

  beforeEach(() => {
    // mock out process.kill
    kill = process.kill;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    process.kill = (pid: number, signal: string | number) => {
      return true;
    };
  });

  afterEach(() => {
    // restore
    process.kill = kill;
  });

  it("refuses to kill nonpositive pids", () => {
    for (const pid of [0, -1, -2]) {
      assert.throws(() => killSidecar(pid), /Refusing to kill process with PID <= 1/);
    }
  });

  it("Will try to kill positive pids", () => {
    const pid = 1234;
    // mock out process.kill
    const kill = process.kill;
    process.kill = (pid: number, signal: string | number) => {
      assert.strictEqual(1234, pid);
      assert.strictEqual("SIGTERM", signal);
      return true;
    };

    assert.doesNotThrow(() => killSidecar(pid));

    // restore
    process.kill = kill;
  });
});
