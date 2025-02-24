import * as assert from "assert";
import "mocha";
import * as sinon from "sinon";
import { SIDECAR_OUTPUT_CHANNEL } from "../constants";
import { outputChannel } from "../logging";
import { SIDECAR_LOGFILE_PATH } from "./constants";
import {
  appendSidecarLogToOutputChannel,
  constructSidecarEnv,
  killSidecar,
  wasConnRefused,
} from "./sidecarManager";

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

describe("appendSidecarLogToOutputChannel() tests", () => {
  let sandbox: sinon.SinonSandbox;

  let debugStub: sinon.SinonStub;
  let infoStub: sinon.SinonStub;
  let warnStub: sinon.SinonStub;
  let errorStub: sinon.SinonStub;
  let appendLineStub: sinon.SinonStub;

  let mainOutputErrorStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    debugStub = sandbox.stub(SIDECAR_OUTPUT_CHANNEL, "debug");
    infoStub = sandbox.stub(SIDECAR_OUTPUT_CHANNEL, "info");
    warnStub = sandbox.stub(SIDECAR_OUTPUT_CHANNEL, "warn");
    errorStub = sandbox.stub(SIDECAR_OUTPUT_CHANNEL, "error");
    appendLineStub = sandbox.stub(SIDECAR_OUTPUT_CHANNEL, "appendLine");

    mainOutputErrorStub = sandbox.stub(outputChannel, "error");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("handles valid JSON logs with different levels", () => {
    const testCases = [
      {
        input: JSON.stringify({
          level: "DEBUG",
          loggerName: "test",
          message: "debug message",
        }),
        expectedStub: debugStub,
        expectedMessage: "[test] debug message",
      },
      {
        input: JSON.stringify({
          level: "INFO",
          loggerName: "test",
          message: "info message",
        }),
        expectedStub: infoStub,
        expectedMessage: "[test] info message",
      },
      {
        input: JSON.stringify({
          level: "WARN",
          loggerName: "test",
          message: "warn message",
        }),
        expectedStub: warnStub,
        expectedMessage: "[test] warn message",
      },
      {
        input: JSON.stringify({
          level: "ERROR",
          loggerName: "test",
          message: "error message",
        }),
        expectedStub: errorStub,
        expectedMessage: "[test] error message",
      },
    ];

    testCases.forEach((testCase) => {
      appendSidecarLogToOutputChannel(testCase.input);

      sinon.assert.calledWith(testCase.expectedStub, testCase.expectedMessage);
    });
  });

  it("handles invalid JSON", () => {
    appendSidecarLogToOutputChannel("invalid json");

    sinon.assert.calledWith(mainOutputErrorStub, sinon.match(/Failed to parse sidecar log line/));
  });

  it("handles log objects with missing fields", () => {
    const logLine = JSON.stringify({ level: "INFO" });

    appendSidecarLogToOutputChannel(logLine);

    sinon.assert.calledWith(appendLineStub, logLine);
  });

  it("handles unexpected log levels", () => {
    const logLine = JSON.stringify({
      level: "UNKNOWN",
      loggerName: "test",
      message: "test message",
    });

    appendSidecarLogToOutputChannel(logLine);

    sinon.assert.calledWith(appendLineStub, `[UNKNOWN] [test] test message`);
  });

  it("handles unexpected log levels with MDC data", () => {
    const mdc = {
      key1: "value1",
      key2: "value2",
    };
    const logLine = JSON.stringify({
      level: "UNKNOWN",
      loggerName: "test",
      message: "test message",
      mdc,
    });

    appendSidecarLogToOutputChannel(logLine);

    sinon.assert.calledWith(
      appendLineStub,
      `[UNKNOWN] [test] test message ${JSON.stringify([mdc])}`,
    );
  });

  it("handles MDC data", () => {
    /** @see https://quarkus.io/guides/logging#use-mdc-to-add-contextual-log-information */
    const mdc = {
      key1: "value1",
      key2: "value2",
    };
    const logLineWithMdc = JSON.stringify({
      level: "INFO",
      loggerName: "test",
      message: "test message",
      mdc,
    });

    appendSidecarLogToOutputChannel(logLineWithMdc);

    sinon.assert.calledWith(infoStub, "[test] test message", mdc);
  });
});
