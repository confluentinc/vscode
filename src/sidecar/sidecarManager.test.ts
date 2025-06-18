import * as assert from "assert";
import "mocha";
import * as sinon from "sinon";
import { Tail } from "tail";
import * as errors from "../errors";
import * as fsWrappers from "../utils/fsWrappers";
import { SidecarFatalError } from "./errors";
import * as sidecarLogging from "./logging";
import { SidecarManager } from "./sidecarManager";
import { SidecarLogFormat, SidecarOutputs, SidecarStartupFailureReason } from "./types";
import * as utils from "./utils";

describe("sidecarManager.ts", () => {
  describe("class SidecarManager", () => {
    let sandbox: sinon.SinonSandbox;
    let clock: sinon.SinonFakeTimers;
    let manager: SidecarManager;

    let logErrorStub: sinon.SinonStub;

    beforeEach(() => {
      sandbox = sinon.createSandbox();
      clock = sandbox.useFakeTimers();
      manager = new SidecarManager();
      logErrorStub = sandbox.stub(errors, "logError");
    });

    afterEach(() => {
      clock.restore();
      sandbox.restore();
    });

    describe("startSidecar()", () => {
      let startSidecar: (callnum: number) => Promise<string>;
      let checkSidecarFileStub: sinon.SinonStub;
      let writeFileSync: sinon.SinonStub;
      let closeSyncStub: sinon.SinonStub;

      let spawnStub: sinon.SinonStub;

      const stderrFiledescriptor = 42;

      beforeEach(async () => {
        // is private method, so have to reach a bit to be able to test it directly.
        startSidecar = manager["startSidecar"].bind(manager);
        // Default to the sidecar file being present by not throwing.
        checkSidecarFileStub = sandbox.stub(utils, "checkSidecarFile");
        writeFileSync = sandbox.stub(fsWrappers, "writeFileSync");
        sandbox.stub(fsWrappers, "openSync").returns(stderrFiledescriptor);
        closeSyncStub = sandbox.stub(fsWrappers, "closeSync");

        spawnStub = sandbox.stub(utils, "spawn");
      });

      afterEach(() => {
        // logErrorStub should not have been caller at any time
        // by startSidecar(). That's the responsibility of calling code.
        sinon.assert.notCalled(logErrorStub);
      });

      describe("Errors leading up to spawn()", () => {
        it("handles missing sidecar file", async () => {
          checkSidecarFileStub.throws(
            new SidecarFatalError(
              SidecarStartupFailureReason.MISSING_EXECUTABLE,
              "Sidecar file not found",
            ),
          );
          try {
            await startSidecar(1);
          } catch (e) {
            if (e instanceof SidecarFatalError) {
              assert.strictEqual(e.reason, SidecarStartupFailureReason.MISSING_EXECUTABLE);
              assert.strictEqual(e.message, "Sidecar file not found");
              return;
            }
          }

          assert.fail("Expected SidecarFatalError to be thrown");
        });

        it("handles unexpected error raised when creating sidecar stderr file", async () => {
          writeFileSync.throws(new Error("EPERM"));
          try {
            await startSidecar(1);
          } catch (e) {
            // was a truly unexpected error, should be coerced to a SidecarFatalError/UNKNOWN
            if (e instanceof SidecarFatalError) {
              assert.strictEqual(e.reason, SidecarStartupFailureReason.UNKNOWN);
              assert.strictEqual(e.message, "startSidecar(1): Unexpected error: Error: EPERM");
              return;
            }
          }
          assert.fail("Expected SidecarFatalError to be thrown");
        });

        it("Handles spawn/UNKNONW error", async () => {
          spawnStub.throws(new Error("UNKNOWN"));
          try {
            await startSidecar(1);
          } catch (e) {
            if (e instanceof SidecarFatalError) {
              assert.strictEqual(e.reason, SidecarStartupFailureReason.SPAWN_RESULT_UNKNOWN);
              assert.strictEqual(
                e.message,
                "startSidecar(1): Failed to spawn sidecar process: UNKNOWN",
              );
              sinon.assert.calledWith(closeSyncStub, stderrFiledescriptor);
              return;
            }
          }

          assert.fail("Expected SidecarFatalError to be thrown");
        });

        it("Handles spawn/random error", async () => {
          spawnStub.throws(new Error("random error"));
          try {
            await startSidecar(1);
          } catch (e) {
            if (e instanceof SidecarFatalError) {
              assert.strictEqual(e.reason, SidecarStartupFailureReason.SPAWN_ERROR);
              assert.strictEqual(
                e.message,
                "startSidecar(1): Failed to spawn sidecar process: random error",
              );
              sinon.assert.calledWith(closeSyncStub, stderrFiledescriptor);
              return;
            }
          }
          assert.fail("Expected SidecarFatalError to be thrown");
        });
      });

      describe("After successful spawn()", () => {
        let mockProcess: { pid: number | undefined; unref: () => void };

        let confirmSidecarProcessIsRunningStub: sinon.SinonStub;
        let doHandshakeStub: sinon.SinonStub;

        beforeEach(() => {
          mockProcess = {
            pid: 1234,
            unref: () => {},
          };
          spawnStub.returns(mockProcess);
          confirmSidecarProcessIsRunningStub = sinon
            .stub(manager, "confirmSidecarProcessIsRunning")
            .resolves();

          doHandshakeStub = sandbox.stub(manager, "doHandshake").resolves("access-token");
          sandbox.stub(utils, "pause").resolves();
        });

        afterEach(() => {
          sinon.assert.calledWith(closeSyncStub, stderrFiledescriptor);
        });

        it("Handles undefined PID", async () => {
          mockProcess.pid = undefined;
          try {
            await startSidecar(1);
          } catch (e) {
            if (e instanceof SidecarFatalError) {
              assert.strictEqual(e.reason, SidecarStartupFailureReason.SPAWN_RESULT_UNDEFINED_PID);
              assert.strictEqual(e.message, "startSidecar(1): sidecar process has undefined PID");
              return;
            }
          }
          assert.fail("Expected SidecarFatalError to be thrown");
        });

        it("Handles confirmSidecarProcessIsRunning() error", async () => {
          confirmSidecarProcessIsRunningStub.throws(
            new SidecarFatalError(
              SidecarStartupFailureReason.PORT_IN_USE,
              "Port in use by another process",
            ),
          );
          try {
            const startPromise = startSidecar(1);
            clock.tick(2001);
            await startPromise;
          } catch (e) {
            if (e instanceof SidecarFatalError) {
              assert.strictEqual(e.reason, SidecarStartupFailureReason.PORT_IN_USE);
              return;
            }
          }
          assert.fail("Expected SidecarFatalError to be thrown");
        });

        it("Handles doHandshake() repeated ECONNREFUSED", async () => {
          sandbox.stub(utils, "wasConnRefused").returns(true);
          doHandshakeStub.throws(new Error("ECONNREFUSED"));
          try {
            // pause() is stubbed to resolve immediately, and
            // wasConnRefused() is stubbed to always be true, so
            // we should get a SidecarFatalError after MAX_ATTEMPTS.
            await startSidecar(1);
          } catch (e) {
            if (e instanceof SidecarFatalError) {
              assert.strictEqual(e.reason, SidecarStartupFailureReason.HANDSHAKE_FAILED);
              return;
            }
          }
          assert.fail("Expected SidecarFatalError to be thrown");
        });
      });
    });

    describe("confirmSidecarProcessIsRunning()", () => {
      let isProcessRunningStub: sinon.SinonStub;

      beforeEach(() => {
        isProcessRunningStub = sandbox.stub(utils, "isProcessRunning");
      });

      it("Happy when process is running", async () => {
        isProcessRunningStub.returns(true);
        // does not throw.
        await manager.confirmSidecarProcessIsRunning(1234, "", "");
      });

      it("Does proper things when process is not running", async () => {
        isProcessRunningStub.returns(false);
        sandbox.stub(sidecarLogging, "gatherSidecarOutputs").resolves({
          logLines: [],
          parsedLogLines: [
            {
              timestamp: "2023-10-01T00:00:00.000Z",
              level: "ERROR",
              loggerName: "com.example.Sidecar",
              message: "Oh noes! My port!",
            } as SidecarLogFormat,
          ],
          stderrLines: [],
        } as SidecarOutputs);

        sandbox
          .stub(sidecarLogging, "determineSidecarStartupFailureReason")
          .returns(SidecarStartupFailureReason.PORT_IN_USE);

        try {
          await manager.confirmSidecarProcessIsRunning(2345, "prefix", "");
        } catch (e) {
          if (e instanceof SidecarFatalError) {
            assert.strictEqual(
              e.message,
              "prefix: Sidecar process 2345 died immediately after startup",
            );
            // And sentry was sent extra goodies.
            sinon.assert.called(logErrorStub);
            return;
          }
        }
        assert.fail("Expected NoSidecarRunningError to be thrown");
      });
    });

    describe("dispose()", () => {
      let disposeStub: sinon.SinonStub;

      beforeEach(() => {
        disposeStub = sandbox.stub(sidecarLogging, "disposeSidecarLogTail");
      });

      it("should not call disposeSidecarLogTail and leave private logTailer undefined when no logTailer is set", () => {
        manager["logTailer"] = undefined;

        manager.dispose();

        // should do nothing.
        assert.strictEqual(manager["logTailer"], undefined);
        sinon.assert.notCalled(disposeStub);
      });

      it("should call disposeSidecarLogTail and clear logTailer when logTailer is set", () => {
        manager["logTailer"] = {} as unknown as Tail;

        manager.dispose();

        sinon.assert.calledOnce(disposeStub);
        // and should be dereferenced.
        assert.strictEqual(manager["logTailer"], undefined);
      });
    });
  });
});
