import * as assert from "assert";
import * as path from "path";
import * as sinon from "sinon";
import * as sidecarLogging from "./logging";
import { SidecarOutputs, SidecarStartupFailureReason } from "./types";
import { divineSidecarStartupFailureReason, gatherSidecarOutputs, isProcessRunning } from "./utils";

describe("sidecar/utils.ts", () => {
  describe("divineSidecarStartupFailureReason()", () => {
    it("should return PORT_IN_USE when the log contains 'seems to be in use by another process'", () => {
      const outputs: SidecarOutputs = {
        parsedLogLines: [{ message: "seems to be in use by another process" } as any],
        logLines: [],
        stderrLines: [],
      };
      const result = divineSidecarStartupFailureReason("linux", outputs);
      assert.strictEqual(result, SidecarStartupFailureReason.PORT_IN_USE);
    });

    it("should return UNKNOWN when no specific error messages are found", () => {
      const outputs: SidecarOutputs = {
        parsedLogLines: [{ message: "some other log message" } as any],
        logLines: [],
        stderrLines: [],
      };
      const result = divineSidecarStartupFailureReason("linux", outputs);
      assert.strictEqual(result, SidecarStartupFailureReason.UNKNOWN);
    });
  });

  describe("gatherSidecarOutputs()", () => {
    let sandbox: sinon.SinonSandbox;

    beforeEach(() => {
      sandbox = sinon.createSandbox();
    });

    afterEach(() => {
      sandbox.restore();
    });

    /**
     * Set getSidecarLogfilePathStub and fsReadFileSyncStub to read sidecar logs / stderr
     * from golden files in tests/fixtures/sidecarLogs/{fixtureName}
     *
     * @return The resulting stderr path.
     **/
    function useFixture(fixtureName: string): string {
      const parentPath = path.join(
        __dirname,
        "..",
        "..",
        "..",
        "tests",
        "fixtures",
        "sidecarLogs",
        fixtureName,
      );

      const sidecarLogPath = path.join(parentPath, "vscode-confluent-sidecar.log");
      const stderrPath = path.join(parentPath, "vscode-confluent-sidecar.log.stderr");
      sandbox.stub(sidecarLogging, "getSidecarLogfilePath").returns(sidecarLogPath);

      // sandbox.stub(fsWrappers, "readFile").callsFake(async (uri: Uri) => {
      //   const filePath = uri.fsPath;
      //   return fs.readFileSync(filePath, "utf8");
      // });

      return stderrPath;
    }

    it("should read happy logs and empty stderr", async () => {
      // Has 11 parseable log lines, 1 degenerate stderr line
      const stderrPath = useFixture("clean");
      const result = await gatherSidecarOutputs(stderrPath);
      assert.strictEqual(result.logLines.length, 11);
      assert.strictEqual(result.parsedLogLines.length, 11);

      assert.strictEqual(result.parsedLogLines[0].message, "Sidecar starting...");
      assert.strictEqual(
        result.parsedLogLines[10].message,
        "Checking for overdue inactive websocket sessions to purge every 60s, max allowed initial connection duration 60s.",
      );

      assert.strictEqual(result.stderrLines.length, 0);
    });

    it("Will skip broken json log lines", async () => {
      // Has 11 log lines, first 2 of which are broken JSON.
      const stderrPath = useFixture("broken-json");
      const result = await gatherSidecarOutputs(stderrPath);
      assert.strictEqual(result.logLines.length, 11);

      // First two lines were skipped / broken json format
      assert.strictEqual(result.parsedLogLines.length, 9);
      assert.strictEqual(
        result.parsedLogLines[0].message,
        "ide-sidecar 0.201.0 native (powered by Quarkus 3.15.1) started in 0.041s. Listening on: http://127.0.0.1:26636",
      );

      assert.strictEqual(result.stderrLines.length, 0);
    });

    it("Will skip unexpected format json log lines", async () => {
      // has 1 line, missing timestamp. Will not be parsed.
      const stderrPath = useFixture("unexpected-json-structure");
      const result = await gatherSidecarOutputs(stderrPath);
      assert.strictEqual(result.logLines.length, 1);
      assert.strictEqual(result.parsedLogLines.length, 0);
    });

    it("Reads nonempty stderr + empty log", async () => {
      // Has 0 log lines, 1 degenerate stderr line
      const stderrPath = useFixture("sidecar-glibc-death");
      const result = await gatherSidecarOutputs(stderrPath);
      assert.strictEqual(result.logLines.length, 0);
      assert.strictEqual(result.parsedLogLines.length, 0);

      assert.strictEqual(result.stderrLines.length, 1);
      assert.match(result.stderrLines[0], /GLIBC_2.25.*not found/);
    });

    it("Handles nonexistent log and stderr files", async () => {
      // empty directory!
      const stderrPath = useFixture("nonexistent");
      const result = await gatherSidecarOutputs(stderrPath);
      assert.strictEqual(result.logLines.length, 0);
      assert.strictEqual(result.parsedLogLines.length, 0);

      assert.strictEqual(result.stderrLines.length, 0);
    });
  });

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
});
