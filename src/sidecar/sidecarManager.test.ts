import * as assert from "assert";
import "mocha";
import * as sinon from "sinon";
import * as errors from "../errors";
import * as fsWrappers from "../utils/fsWrappers";
import { SidecarFatalError } from "./errors";
import { SidecarManager } from "./sidecarManager";
import { SidecarStartupFailureReason } from "./types";
import * as utils from "./utils";

describe("sidecarManager.ts", () => {
  // describe("getHandlePromise()", () => {
  //   let sandbox: sinon.SinonSandbox;
  //   let manager: SidecarManager;
  //   let getAuthTokenFromSecretStoreStub: sinon.SinonStub;
  //   let healthCheckStub: sinon.SinonStub;
  //   beforeEach(() => {
  //     sandbox = sinon.createSandbox();
  //     manager = new SidecarManager();
  //     getAuthTokenFromSecretStoreStub = sandbox.stub(manager, "getAuthTokenFromSecretStore");
  //     healthCheckStub = sandbox.stub(manager, "healthCheck");
  //   });

  //   afterEach(() => {
  //     sandbox.restore();
  //   });
  // });

  describe("startSidecar()", () => {
    let sandbox: sinon.SinonSandbox;
    let manager: SidecarManager;
    let checkSidecarFileStub: sinon.SinonStub;
    let writeFileSync: sinon.SinonStub;
    let closeSyncStub: sinon.SinonStub;
    let logErrorStub: sinon.SinonStub;
    let spawnStub: sinon.SinonStub;
    let clock: sinon.SinonFakeTimers;
    let startSidecar: (callnum: number) => Promise<string>;

    const stderrFiledescriptor = 42;

    beforeEach(async () => {
      sandbox = sinon.createSandbox();
      clock = sandbox.useFakeTimers();

      manager = new SidecarManager();
      // is private method, so have to reach a bit to be able to test it directly.
      startSidecar = manager["startSidecar"].bind(manager);
      // Default to the sidecar file being present by not throwing.
      checkSidecarFileStub = sandbox.stub(utils, "checkSidecarFile");
      writeFileSync = sandbox.stub(fsWrappers, "writeFileSync");
      sandbox.stub(fsWrappers, "openSync").returns(stderrFiledescriptor);
      closeSyncStub = sandbox.stub(fsWrappers, "closeSync");
      logErrorStub = sandbox.stub(errors, "logError");
      spawnStub = sandbox.stub(utils, "spawn");
    });

    afterEach(() => {
      // logErrorStub should not have been caller at any time
      // by startSidecar(). That's the responsibility of calling code.
      sinon.assert.notCalled(logErrorStub);
      clock.restore();
      sandbox.restore();
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
});
