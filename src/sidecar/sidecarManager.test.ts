import * as assert from "assert";
import "mocha";
import { join } from "path";
import * as sinon from "sinon";
import { SIDECAR_OUTPUT_CHANNEL } from "../constants";
import { OUTPUT_CHANNEL } from "../logging";
import { WriteableTmpDir } from "../utils/file";
import { SIDECAR_LOGFILE_NAME } from "./constants";
import {
  appendSidecarLogToOutputChannel,
  constructSidecarEnv,
  getSidecarLogfilePath,
  killSidecar,
  MOMENTARY_PAUSE_MS,
  safeKill,
  WAIT_FOR_SIDECAR_DEATH_MS,
  wasConnRefused,
} from "./sidecarManager";

import * as utils from "./utils";

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
  before(async () => {
    // Ensure the tmpdir is established
    await WriteableTmpDir.getInstance().determine();
  });

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
    assert.strictEqual(result.QUARKUS_LOG_FILE_PATH, getSidecarLogfilePath());
  });

  it("Other preset env vars are set as expected", () => {
    const env = { FOO: "bar" };
    const result = constructSidecarEnv(env);
    assert.strictEqual("bar", result.FOO);
  });
});

describe("killSidecar() tests", () => {
  let sandbox: sinon.SinonSandbox;
  let killStub: sinon.SinonStub;
  let clock: sinon.SinonFakeTimers;
  const pid = 1234;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    killStub = sandbox.stub(process, "kill");
    sandbox.stub(utils, "pause").resolves();
    clock = sandbox.useFakeTimers(Date.now());
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("refuses to kill nonpositive pids", async () => {
    for (const pid of [0, -1, -2]) {
      await assert.rejects(
        async () => await killSidecar(pid),
        /Refusing to kill process with PID <= 1/,
      );
    }
  });

  it("Will try to kill positive pids", async () => {
    // Expect first call to kill the pid with SIGTERM.
    killStub.onFirstCall().returns(true);
    // Second call should be kill(pid, 0) to check if the process is still alive. Indicate that
    // it is not alive.
    killStub.onSecondCall().throws(new Error("process does not exist"));

    await assert.doesNotReject(async () => await killSidecar(pid));

    assert.strictEqual(killStub.callCount, 2);
    assert.strictEqual(killStub.getCall(0).args[0], pid);
    assert.strictEqual(killStub.getCall(0).args[1], "SIGTERM");

    assert.strictEqual(killStub.getCall(1).args[0], pid);
    assert.strictEqual(killStub.getCall(1).args[1], 0);
  });

  it("Will loop after SIGTERM until the process is dead, but then be content when it dies", async () => {
    let checkCallCount = 0;
    // Expect first call to kill the pid with SIGTERM.
    killStub.callsFake(
      // Set up so that the first call with SIGTERM returns true (process killed),
      // then the first 3 calls with 0 return true (process still alive),
      // then the last call with 0 throws an error (process not alive).
      (pid: number, signal: string | number) => {
        if (signal === "SIGTERM") {
          return true; // let the call to kill the process succeed.
        } else if (signal === 0) {
          // Is checking to see if pid is still alive.
          // Simulate the process being alive for first 3 checks.
          checkCallCount++;
          if (checkCallCount < 3) {
            return true; // process still alive the first few times
          } else {
            throw new Error("process does not exist"); // process not alive anymore
          }
        }
      },
    );

    const promise = killSidecar(pid);

    // first loop pause ...
    await clock.tickAsync(MOMENTARY_PAUSE_MS + 1);
    // second
    await clock.tickAsync(MOMENTARY_PAUSE_MS + 1);
    // third
    await clock.tickAsync(MOMENTARY_PAUSE_MS + 1);

    await assert.doesNotReject(promise);

    assert.strictEqual(killStub.callCount, 4, "total call count"); // 1 kill + 3 checks
    assert.strictEqual(checkCallCount, 3, "checkCallCount"); // 3 checks before process is dead
  });

  it("Will upgrade to SIGKILL if process is still alive after WAIT_FOR_SIDECAR_DEATH_MS / MOMENTARY_PAUSE_MS checks", async () => {
    let receivedSigTerm = false;
    let receivedSigKill = false;
    killStub.callsFake(
      // Set up so that the first call with SIGTERM returns true (process killed),
      // then the first 3 calls with 0 return true (process still alive),
      // then the last call with 0 throws an error (process not alive).
      (pid: number, signal: string | number) => {
        if (signal === "SIGTERM") {
          receivedSigTerm = true;
          return true; // let the call to kill the process succeed.
        } else if (signal === "SIGKILL") {
          receivedSigKill = true;
          return true; // let the call to kill the process succeed.
        } else if (signal === 0) {
          // Indicate is alive until receivedSigKill is delivered.
          if (!receivedSigKill) {
            return true; // process still alive the first few times
          } else {
            throw new Error("process does not exist"); // process not alive anymore
          }
        }
      },
    );

    // Will send sigterm. Then loop poll for WAIT_FOR_SIDECAR_DEATH_MS / MOMENTARY_PAUSE_MS
    // times waiting for death, then will upgrade to SIGKILL.
    const promise = killSidecar(pid);

    for (let i = 0; i < WAIT_FOR_SIDECAR_DEATH_MS / MOMENTARY_PAUSE_MS; i++) {
      await clock.tickAsync(MOMENTARY_PAUSE_MS + 1);
    }

    await assert.doesNotReject(promise);

    assert.strictEqual(receivedSigTerm, true, "receivedSigTerm");
    assert.strictEqual(receivedSigKill, true, "receivedSigKill");
  });

  it("Throws if process is still alive after SIGKILL", async () => {
    let receivedSigTerm = false;
    let receivedSigKill = false;
    killStub.callsFake(
      // Simulate that for some reason the sidecar never dies, even after SIGKILL.
      // (say, it is a zombie process or in device wait against bad NFS mount)
      (pid: number, signal: string | number) => {
        if (signal === "SIGTERM") {
          receivedSigTerm = true;
          return true; // let the call to kill the process succeed.
        } else if (signal === "SIGKILL") {
          receivedSigKill = true;
        } else if (signal === 0) {
          return true; // process always still alive
        }
      },
    );

    const promise = killSidecar(pid);

    // loop through all of the sigterm checks, then the sigkill checks.
    for (let i = 0; i < 2 * (WAIT_FOR_SIDECAR_DEATH_MS / MOMENTARY_PAUSE_MS); i++) {
      await clock.tickAsync(MOMENTARY_PAUSE_MS + 1);
    }

    await assert.rejects(promise, /Failed to kill old sidecar process/);

    assert.strictEqual(receivedSigTerm, true, "receivedSigTerm");
    assert.strictEqual(receivedSigKill, true, "receivedSigKill");
  });
});

describe("safeKill() tests", () => {
  let sandbox: sinon.SinonSandbox;
  let killStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    killStub = sandbox.stub(process, "kill");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("safeKill() should call kill with the correct arguments", () => {
    const pid = 1234;
    const signal = "SIGTERM";

    safeKill(pid, signal);

    assert.strictEqual(killStub.calledWith(pid, signal), true);
  });

  it("safeKill() should not throw an error if kill raises error", () => {
    const pid = 1234;
    const signal = "SIGTERM";

    killStub.throws(new Error("test error"));

    assert.doesNotThrow(() => {
      safeKill(pid, signal);
    });
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

    mainOutputErrorStub = sandbox.stub(OUTPUT_CHANNEL, "error");
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

describe("getSidecarLogfilePath() tests", () => {
  let sandbox: sinon.SinonSandbox;
  let writeableTmpDirMock: sinon.SinonMock;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    writeableTmpDirMock = sandbox.mock(WriteableTmpDir.getInstance());
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("Returns the expected path when getWriteableTmpDir() succeeds", () => {
    writeableTmpDirMock.expects("get").returns("/tmp");
    const expectedPath = join("/tmp", SIDECAR_LOGFILE_NAME);
    const actualPath = getSidecarLogfilePath();
    assert.strictEqual(actualPath, expectedPath);
  });

  it("When getWriteableTmpDir() fails, getSidecarLogfilePath() should throw an error", () => {
    writeableTmpDirMock
      .expects("get")
      .throws(new Error("get() called before determine() was awaited."));
    assert.throws(() => {
      getSidecarLogfilePath();
    }, /get\(\) called before determine\(\) was awaited./);
  });
});
