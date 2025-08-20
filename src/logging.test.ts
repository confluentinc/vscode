import * as assert from "assert";
import { RotatingFileStream } from "rotating-file-stream";
import * as sinon from "sinon";
import { LogOutputChannel, Uri } from "vscode";
import {
  BASEFILE_PREFIX,
  CURRENT_LOGFILE_NAME,
  Logger,
  MAX_LOGFILES,
  OUTPUT_CHANNEL,
  ROTATED_LOGFILE_NAMES,
  rotatingFilenameGenerator,
  RotatingLogManager,
  RotatingLogOutputChannel,
} from "./logging";
import { WriteableTmpDir } from "./utils/file";
import * as fsWrappers from "./utils/fsWrappers";

describe("logging.ts", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  // Logger methods
  describe("Logger methods", function () {
    let traceStub: sinon.SinonStub;
    let debugStub: sinon.SinonStub;
    let infoStub: sinon.SinonStub;
    let warnStub: sinon.SinonStub;
    let errorStub: sinon.SinonStub;

    let logger: Logger;

    beforeEach(function () {
      // stub output channel methods
      traceStub = sandbox.stub(OUTPUT_CHANNEL, "trace");
      debugStub = sandbox.stub(OUTPUT_CHANNEL, "debug");
      infoStub = sandbox.stub(OUTPUT_CHANNEL, "info");
      warnStub = sandbox.stub(OUTPUT_CHANNEL, "warn");
      errorStub = sandbox.stub(OUTPUT_CHANNEL, "error");

      // create a new logger instance for each test
      logger = new Logger("test");
    });

    it("should call OUTPUT_CHANNEL.trace when .trace() is called", function () {
      logger.trace("test message");

      assert.strictEqual(traceStub.calledOnce, true);
      assert.strictEqual(traceStub.firstCall.args[0], "[test] test message");
    });

    it("should call OUTPUT_CHANNEL.debug when .debug() is called", function () {
      logger.debug("test message");

      assert.strictEqual(debugStub.calledOnce, true);
      assert.strictEqual(debugStub.firstCall.args[0], "[test] test message");
    });

    it("should call OUTPUT_CHANNEL.info when .log() is called", function () {
      logger.log("test message");

      assert.strictEqual(infoStub.calledOnce, true);
      assert.strictEqual(infoStub.firstCall.args[0], "[test] test message");
    });

    it("should call OUTPUT_CHANNEL.info when .info() is called", function () {
      logger.info("test message");

      assert.strictEqual(infoStub.calledOnce, true);
      assert.strictEqual(infoStub.firstCall.args[0], "[test] test message");
    });

    it("should call OUTPUT_CHANNEL.warn when .warn() is called", function () {
      logger.warn("test message");

      assert.strictEqual(warnStub.calledOnce, true);
      assert.strictEqual(warnStub.firstCall.args[0], "[test] test message");
    });

    it("should call OUTPUT_CHANNEL.error when .error() is called", function () {
      logger.error("test message");

      assert.strictEqual(errorStub.calledOnce, true);
      assert.strictEqual(errorStub.firstCall.args[0], "[test] test message");
    });

    it("should create a new logger with callpoint when withCallpoint is used", function () {
      const boundLogger = logger.withCallpoint("testpoint");

      // call a method on the bound logger to check the modified prefix
      boundLogger.info("test message");

      assert.strictEqual(infoStub.calledOnce, true);
      assert.strictEqual(infoStub.firstCall.args[0].includes("[test[testpoint.0]]"), true);
    });
  });

  // original rotatingFilenameGenerator
  describe("rotatingFilenameGenerator", function () {
    it("should leave ROTATED_LOGFILE_NAMES empty before any rotations", function () {
      const fileName: string = rotatingFilenameGenerator(new Date(), 0);

      assert.strictEqual(fileName, `vscode-confluent-${process.pid}.log`);
      // no rotations yet
      assert.strictEqual(ROTATED_LOGFILE_NAMES.length, 0);
      assert.strictEqual(CURRENT_LOGFILE_NAME, `vscode-confluent-${process.pid}.log`);
    });

    it("should generate a new filename with a higher index", function () {
      const fileName: string = rotatingFilenameGenerator(new Date(), 1);

      assert.strictEqual(fileName, `vscode-confluent-${process.pid}.1.log`);
      // one rotated file, current left alone
      assert.strictEqual(ROTATED_LOGFILE_NAMES.length, 1);
      assert.strictEqual(ROTATED_LOGFILE_NAMES[0], `vscode-confluent-${process.pid}.1.log`);
      assert.strictEqual(CURRENT_LOGFILE_NAME, `vscode-confluent-${process.pid}.log`);
    });

    it(`should only keep the last ${MAX_LOGFILES} log files in ROTATED_LOGFILE_NAMES`, function () {
      // start at 1 since 0 is the current log file index
      for (let i = 1; i <= MAX_LOGFILES; i++) {
        const fileName = rotatingFilenameGenerator(new Date(), i);
        assert.strictEqual(fileName, `vscode-confluent-${process.pid}.${i}.log`);
      }

      assert.strictEqual(ROTATED_LOGFILE_NAMES.length, MAX_LOGFILES);
      assert.strictEqual(CURRENT_LOGFILE_NAME, `vscode-confluent-${process.pid}.log`);
    });
  });

  // constants for testing RotatingLogManager and RotatingLogOutputChannel
  const TEST_BASEPATH = "test-base-path";

  describe("RotatingLogManager", () => {
    let instanceOfRotatingLogManager: RotatingLogManager;

    beforeEach(() => {
      // create new RotatingLogManager instance for each test
      instanceOfRotatingLogManager = new RotatingLogManager(TEST_BASEPATH);
    });

    afterEach(() => {
      instanceOfRotatingLogManager.dispose();
    });

    describe("rotatingFilenameGenerator", () => {
      it("should instantiate with empty _rotatedFileNames", function () {
        const fileName = instanceOfRotatingLogManager.rotatingFilenameGenerator(new Date(), 0);
        const currentFileName = instanceOfRotatingLogManager["_currentFileName"];
        const rotatedFileNames = instanceOfRotatingLogManager["_rotatedFileNames"];

        assert.strictEqual(fileName, `${BASEFILE_PREFIX}-${TEST_BASEPATH}.log`);
        // no rotations yet
        assert.strictEqual(rotatedFileNames.length, 0);
        assert.strictEqual(currentFileName, `${BASEFILE_PREFIX}-${TEST_BASEPATH}.log`);
      });

      it("should generate filename without index", function () {
        const filename = instanceOfRotatingLogManager.rotatingFilenameGenerator(new Date());

        assert.strictEqual(filename, `${BASEFILE_PREFIX}-${TEST_BASEPATH}.log`);
      });

      it("should generate a new filename with a higher index", function () {
        const fileName1 = instanceOfRotatingLogManager.rotatingFilenameGenerator(new Date(), 1);
        const fileName2 = instanceOfRotatingLogManager.rotatingFilenameGenerator(new Date(), 2);
        const currentFileName = instanceOfRotatingLogManager["_currentFileName"];
        const rotatedFileNames = instanceOfRotatingLogManager["_rotatedFileNames"];

        assert.strictEqual(fileName1, `${BASEFILE_PREFIX}-${TEST_BASEPATH}.1.log`);
        assert.strictEqual(fileName2, `${BASEFILE_PREFIX}-${TEST_BASEPATH}.2.log`);
        // one rotated file, current left alone
        assert.strictEqual(rotatedFileNames.length, 2);
        assert.strictEqual(rotatedFileNames[0], `${BASEFILE_PREFIX}-${TEST_BASEPATH}.1.log`);
        assert.strictEqual(rotatedFileNames[1], `${BASEFILE_PREFIX}-${TEST_BASEPATH}.2.log`);
        assert.strictEqual(currentFileName, `${BASEFILE_PREFIX}-${TEST_BASEPATH}.log`);
      });

      it("should limit rotated file names to MAX_LOGFILES", function () {
        const rotatedFileNames = instanceOfRotatingLogManager["_rotatedFileNames"];
        for (let i = 1; i <= MAX_LOGFILES + 2; i++) {
          instanceOfRotatingLogManager.rotatingFilenameGenerator(new Date(), i);
        }

        assert.strictEqual(rotatedFileNames.length, MAX_LOGFILES);
      });
    });

    describe("getStream()", () => {
      it("should create a new stream if one doesn't exist", function () {
        // ensure we start with no existing stream
        assert.strictEqual(instanceOfRotatingLogManager["stream"], undefined);

        const stream = instanceOfRotatingLogManager.getStream();

        // check that stream is created and has expected properties
        assert.ok(stream, "Stream should be created");
        // check that the stream is stored internally
        assert.strictEqual(instanceOfRotatingLogManager["stream"], stream);
        // check that stream is not closed initially
        assert.strictEqual(stream.closed, false, "New stream should not be closed");
      });

      it("should return existing stream on subsequent calls", function () {
        const stream1 = instanceOfRotatingLogManager.getStream();
        const stream2 = instanceOfRotatingLogManager.getStream();

        assert.strictEqual(stream1, stream2);
      });
    });

    describe("getFileUris", () => {
      let existsSyncStub: sinon.SinonStub;
      let writeableTmpDirStub: sinon.SinonStub;

      beforeEach(() => {
        // create stub for existsSync to mock creating files on disk
        existsSyncStub = sandbox.stub(fsWrappers, "existsSync");
      });

      it("should return only current file URI when no rotated files exist", () => {
        // create stub for writeableTmpDir to return a test directory
        writeableTmpDirStub = sandbox
          .stub(WriteableTmpDir.getInstance(), "get")
          .returns("/test/dir");
        // mock that only the current file exists
        existsSyncStub.callsFake((uri: Uri) => {
          return uri.fsPath.includes(`${BASEFILE_PREFIX}-${TEST_BASEPATH}.log`);
        });

        const fileUris = instanceOfRotatingLogManager.getFileUris();

        assert.strictEqual(fileUris.length, 1);
        assert.ok(fileUris[0].fsPath.includes(`${BASEFILE_PREFIX}-${TEST_BASEPATH}.log`));
        sinon.assert.calledOnce(writeableTmpDirStub);
      });

      it("should return current and rotated file URIs when rotated files exist", () => {
        // generate some rotated files by calling the filename generator
        instanceOfRotatingLogManager.rotatingFilenameGenerator(new Date(), 1);
        instanceOfRotatingLogManager.rotatingFilenameGenerator(new Date(), 2);

        // mock that all files exist
        existsSyncStub.returns(true);

        const fileUris = instanceOfRotatingLogManager.getFileUris();

        assert.strictEqual(fileUris.length, 3);

        // check current file is included
        const currentFileUri = fileUris.find(
          (uri) =>
            uri.fsPath.includes(`${BASEFILE_PREFIX}-${TEST_BASEPATH}.log`) &&
            !uri.fsPath.includes(".1.") &&
            !uri.fsPath.includes(".2."),
        );
        assert.ok(currentFileUri, "Current file URI should be included");

        // check rotated files are included
        const rotatedFile1Uri = fileUris.find((uri) => uri.fsPath.includes(".1.log"));
        const rotatedFile2Uri = fileUris.find((uri) => uri.fsPath.includes(".2.log"));
        assert.ok(rotatedFile1Uri, "Rotated file 1 URI should be included");
        assert.ok(rotatedFile2Uri, "Rotated file 2 URI should be included");
      });

      it("should filter out non-existent files", () => {
        // generate some rotated files
        instanceOfRotatingLogManager.rotatingFilenameGenerator(new Date(), 1);
        instanceOfRotatingLogManager.rotatingFilenameGenerator(new Date(), 2);

        // mock that only current file and first rotated file exist
        existsSyncStub.callsFake((uri: Uri) => {
          return !uri.fsPath.includes(".2.log");
        });

        const fileUris = instanceOfRotatingLogManager.getFileUris();

        assert.strictEqual(fileUris.length, 2);

        // check that .2.log file is not included
        const missingFile = fileUris.find((uri) => uri.fsPath.includes(".2.log"));
        assert.strictEqual(missingFile, undefined, "Non-existent file should not be included");
      });

      it("should return empty array when no files exist", () => {
        // mock that no files exist
        existsSyncStub.returns(false);

        const fileUris = instanceOfRotatingLogManager.getFileUris();

        assert.strictEqual(fileUris.length, 0);
      });

      it("should return current file + MAX_LOGFILES rotated files", () => {
        // generate maximum number of rotated files
        for (let i = 1; i <= MAX_LOGFILES + 2; i++) {
          instanceOfRotatingLogManager.rotatingFilenameGenerator(new Date(), i);
        }

        existsSyncStub.returns(true);

        const fileUris = instanceOfRotatingLogManager.getFileUris();

        // should have current file + MAX_LOGFILES rotated files
        assert.strictEqual(fileUris.length, MAX_LOGFILES + 1);
      });
    });
  });

  describe("RotatingLogOutputChannel", () => {
    // constants for testing RotatingLogOutputChannel
    const TEST_CHANNELNAME = "test-channel-name";
    const TEST_CONSOLENAME = "test-console-name";

    // stubs for methods to check that data member outputChannel is called correctly
    let traceStub: sinon.SinonStub;
    let debugStub: sinon.SinonStub;
    let infoStub: sinon.SinonStub;
    let warnStub: sinon.SinonStub;
    let errorStub: sinon.SinonStub;
    let appendStub: sinon.SinonStub;
    let appendLineStub: sinon.SinonStub;
    let replaceStub: sinon.SinonStub;
    let clearStub: sinon.SinonStub;
    let hideStub: sinon.SinonStub;
    let showStub: sinon.SinonStub;

    // stub for stream to check method calls from writeToLogFile()
    let streamStub: sinon.SinonStubbedInstance<RotatingFileStream>;

    // instance of RotatingLogOutputChannel to test
    let instance: RotatingLogOutputChannel;
    // member rotating log manager to test
    let logManagerStub: RotatingLogManager;
    // member output channel to test
    let outputChannelStub: LogOutputChannel;

    beforeEach(() => {
      // create new rotating log output channel instance for each test
      instance = new RotatingLogOutputChannel(
        TEST_CHANNELNAME,
        TEST_BASEPATH,
        TEST_CONSOLENAME,
      );

      // stub rotating log output channel methods
      outputChannelStub = instance["outputChannel"];

      traceStub = sandbox.stub(outputChannelStub, "trace");
      debugStub = sandbox.stub(outputChannelStub, "debug");
      infoStub = sandbox.stub(outputChannelStub, "info");
      warnStub = sandbox.stub(outputChannelStub, "warn");
      errorStub = sandbox.stub(outputChannelStub, "error");
      appendStub = sandbox.stub(outputChannelStub, "append");
      appendLineStub = sandbox.stub(outputChannelStub, "appendLine");
      replaceStub = sandbox.stub(outputChannelStub, "replace");      clearStub = sandbox.stub(outputChannelStub, "clear");
      hideStub = sandbox.stub(outputChannelStub, "hide");
      showStub = sandbox.stub(outputChannelStub, "show");

      // stub rotating log manager methods
      logManagerStub = instance["rotatingLogManager"];

      streamStub = sinon.createStubInstance(RotatingFileStream);
      sandbox.stub(logManagerStub, "getStream").returns(streamStub);
    });

    afterEach(function () {
      instance.dispose();
      sandbox.restore();
    });

    it("should get name from member outputChannel", () => {
      assert.strictEqual(instance.name, outputChannelStub.name);
    });

    it('should get logLevel from member outputChannel', () => {
      assert.strictEqual(instance.logLevel, outputChannelStub.logLevel);
    });

    it("should get onDidChangeLogLevel from member outputChannel", () => {
      assert.strictEqual(instance.onDidChangeLogLevel, outputChannelStub.onDidChangeLogLevel);
    });

    it("should handle trace method", () => {
      instance.trace("test message");
      // stream should not be called for trace logs and writeToLogFile() should not be called because it's too verbose
      sinon.assert.notCalled(streamStub.write);

      sinon.assert.calledOnce(traceStub);
      sinon.assert.calledWith(traceStub, `test message`);
    });

    it("should handle debug method", () => {
      instance.debug("debug message");
      // debug logs should be written to the stream with writeToLogFile()
      sinon.assert.calledOnce(streamStub.write);

      sinon.assert.calledOnce(debugStub);
      sinon.assert.calledWith(debugStub, `debug message`);
    });

    it("should handle log method", () => {
      instance.log("log message");
      // log logs should be written to the stream with writeToLogFile()
      sinon.assert.calledOnce(streamStub.write);

      sinon.assert.calledOnce(infoStub);
      sinon.assert.calledWith(infoStub, `log message`);
    });

    it("should handle info method", () => {
      instance.info("info message");
      // info logs should be written to the stream with writeToLogFile()
      sinon.assert.calledOnce(streamStub.write);

      sinon.assert.calledOnce(infoStub);
      sinon.assert.calledWith(infoStub, `info message`);
    });

    it("should handle warn method", () => {
      instance.warn("warn message");
      // warn logs should be written to the stream with writeToLogFile()
      sinon.assert.calledOnce(streamStub.write);

      sinon.assert.calledOnce(warnStub);
      sinon.assert.calledWith(warnStub, `warn message`);
    });

    it("should handle error method", () => {
      instance.error("error message");
      // error logs should be written to the stream with writeToLogFile()
      sinon.assert.calledOnce(streamStub.write);

      sinon.assert.calledOnce(errorStub);
      sinon.assert.calledWith(errorStub, `error message`);
    });

    it("should handle append method", () => {
      instance.append("append message");
      // append logs should be written to the stream with writeToLogFile()
      sinon.assert.calledOnce(streamStub.write);

      sinon.assert.calledOnce(appendStub);
      sinon.assert.calledWith(appendStub, "append message");
    });

    it("should handle appendLine method", () => {
      instance.appendLine("appendLine message");
      // appendLine logs should be written to the stream with writeToLogFile()
      sinon.assert.calledOnce(streamStub.write);

      sinon.assert.calledOnce(appendLineStub);
      sinon.assert.calledWith(appendLineStub, "appendLine message");
    });

    it("should handle replace method", () => {
      instance.replace("replace message");
      // replace logs should be written to the stream with writeToLogFile()
      sinon.assert.calledOnce(streamStub.write);

      sinon.assert.calledOnce(replaceStub);
      sinon.assert.calledWith(replaceStub, "replace message");
    });

    it("should handle clear method", () => {
      instance.clear();
      sinon.assert.calledOnce(clearStub);
    });

    it("should handle hide method", () => {
      instance.hide();
      sinon.assert.calledOnce(hideStub);
    });

    it("should handle show method", () => {
      instance.show();
      sinon.assert.calledOnce(showStub);
    });

    it("should delegate getFileUris() to member RotatingLogManager instance", function () {
      let getFileUrisStub = sinon.stub(logManagerStub, "getFileUris");

      instance.getFileUris();

      // check that getFileUris() is called
      sinon.assert.calledOnce(getFileUrisStub);
    });
  });
});
