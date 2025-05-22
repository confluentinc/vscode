import * as assert from "assert";
import * as path from "path";
import * as sinon from "sinon";
import { OUTPUT_CHANNEL } from "../logging";
import { WriteableTmpDir } from "../utils/file";
import { SIDECAR_LOGFILE_NAME } from "./constants";
import {
  appendSidecarLogToOutputChannel,
  divineSidecarStartupFailureReason,
  gatherSidecarOutputs,
  getSidecarLogfilePath,
  SIDECAR_OUTPUT_CHANNEL,
} from "./logging";
import { SidecarOutputs, SidecarStartupFailureReason } from "./types";

describe("sidecar/logging.ts", () => {
  describe("divineSidecarStartupFailureReason()", () => {
    it("should return PORT_IN_USE when the log contains 'seems to be in use by another process'", () => {
      const outputs: SidecarOutputs = {
        parsedLogLines: [{ message: "seems to be in use by another process" } as any],
        logLines: [],
        stderrLines: [],
      };
      const result = divineSidecarStartupFailureReason(outputs);
      assert.strictEqual(result, SidecarStartupFailureReason.PORT_IN_USE);
    });

    it("should return UNKNOWN when no specific error messages are found", () => {
      const outputs: SidecarOutputs = {
        parsedLogLines: [{ message: "some other log message" } as any],
        logLines: [],
        stderrLines: [],
      };
      const result = divineSidecarStartupFailureReason(outputs);
      assert.strictEqual(result, SidecarStartupFailureReason.UNKNOWN);
    });
  });

  describe("gatherSidecarOutputs()", () => {
    /**
     * Set up to read sidecar logs / stderr from golden files in
     * tests/fixtures/sidecarLogs/{fixtureName}
     *
     * @return pair of the resulting sidecar log path and stderr path.
     **/
    function useGoldenFiles(fixtureName: string): string[] {
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

      return [sidecarLogPath, stderrPath];
    }

    it("should read happy logs and empty stderr", async () => {
      // Has 11 parseable log lines, 1 degenerate stderr line
      const [sidecarLogPath, stderrPath] = useGoldenFiles("clean");
      const result = await gatherSidecarOutputs(sidecarLogPath, stderrPath);
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
      const [sidecarLogPath, stderrPath] = useGoldenFiles("broken-json");
      const result = await gatherSidecarOutputs(sidecarLogPath, stderrPath);
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
      const [sidecarLogPath, stderrPath] = useGoldenFiles("unexpected-json-structure");
      const result = await gatherSidecarOutputs(sidecarLogPath, stderrPath);
      assert.strictEqual(result.logLines.length, 1);
      assert.strictEqual(result.parsedLogLines.length, 0);
    });

    it("Reads nonempty stderr + empty log", async () => {
      // Has 0 log lines, 1 degenerate stderr line
      const [sidecarLogPath, stderrPath] = useGoldenFiles("sidecar-glibc-death");
      const result = await gatherSidecarOutputs(sidecarLogPath, stderrPath);
      assert.strictEqual(result.logLines.length, 0);
      assert.strictEqual(result.parsedLogLines.length, 0);

      assert.strictEqual(result.stderrLines.length, 1);
      assert.match(result.stderrLines[0], /GLIBC_2.25.*not found/);
    });

    it("Handles nonexistent log and stderr files", async () => {
      // empty directory!
      const [sidecarLogPath, stderrPath] = useGoldenFiles("nonexistent");
      const result = await gatherSidecarOutputs(sidecarLogPath, stderrPath);
      assert.strictEqual(result.logLines.length, 0);
      assert.strictEqual(result.parsedLogLines.length, 0);

      assert.strictEqual(result.stderrLines.length, 0);
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
      const expectedPath = path.join("/tmp", SIDECAR_LOGFILE_NAME);
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
});
