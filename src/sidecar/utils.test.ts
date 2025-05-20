import * as assert from "assert";
import * as sinon from "sinon";
import { MOMENTARY_PAUSE_MS } from "./constants";
import {
  isProcessRunning,
  killSidecar,
  safeKill,
  WAIT_FOR_SIDECAR_DEATH_MS,
  wasConnRefused,
} from "./utils";

describe("sidecar/utils.ts", () => {
  describe("isProcessRunning()", () => {
    it("should return true for a running process", async () => {
      const pid = process.pid;
      const result = await isProcessRunning(pid);
      assert.strictEqual(result, true);
    });

    it("should return false for a non-running process", async () => {
      const result = await isProcessRunning(-17); // -17 is not a valid PID
      assert.strictEqual(result, false);
    });
  });

  describe("safeKill()", () => {
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

  describe("killSidecar()", () => {
    let sandbox: sinon.SinonSandbox;
    let killStub: sinon.SinonStub;
    let clock: sinon.SinonFakeTimers;
    const pid = 1234;

    beforeEach(() => {
      sandbox = sinon.createSandbox();
      killStub = sandbox.stub(process, "kill");
      // sandbox.stub(utils, "pause").resolves();
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

  describe("wasConnRefused()", () => {
    it("should return true for various spellings of a connection refused error", () => {
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

    it("should return false for non-connection-refused errors", () => {
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
});
