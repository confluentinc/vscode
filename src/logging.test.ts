import * as assert from "assert";
import { RotatingFileStream } from "rotating-file-stream";
import * as sinon from "sinon";
import { LogOutputChannel, Uri } from "vscode";
import {
  BASEFILE_PREFIX,
  EXTENSION_OUTPUT_CHANNEL,
  Logger,
  MAX_LOGFILES,
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
      traceStub = sandbox.stub(EXTENSION_OUTPUT_CHANNEL, "trace");
      debugStub = sandbox.stub(EXTENSION_OUTPUT_CHANNEL, "debug");
      infoStub = sandbox.stub(EXTENSION_OUTPUT_CHANNEL, "info");
      warnStub = sandbox.stub(EXTENSION_OUTPUT_CHANNEL, "warn");
      errorStub = sandbox.stub(EXTENSION_OUTPUT_CHANNEL, "error");

      // create a new logger instance for each test
      logger = new Logger("test");
    });

    it("should call EXTENSION_OUTPUT_CHANNEL.trace when .trace() is called", function () {
      logger.trace("test message");

      assert.strictEqual(traceStub.calledOnce, true);
      assert.strictEqual(traceStub.firstCall.args[0], "[test] test message");
    });

    it("should call EXTENSION_OUTPUT_CHANNEL.debug when .debug() is called", function () {
      logger.debug("test message");

      assert.strictEqual(debugStub.calledOnce, true);
      assert.strictEqual(debugStub.firstCall.args[0], "[test] test message");
    });

    it("should call EXTENSION_OUTPUT_CHANNEL.info when .log() is called", function () {
      logger.log("test message");

      assert.strictEqual(infoStub.calledOnce, true);
      assert.strictEqual(infoStub.firstCall.args[0], "[test] test message");
    });

    it("should call EXTENSION_OUTPUT_CHANNEL.info when .info() is called", function () {
      logger.info("test message");

      assert.strictEqual(infoStub.calledOnce, true);
      assert.strictEqual(infoStub.firstCall.args[0], "[test] test message");
    });

    it("should call EXTENSION_OUTPUT_CHANNEL.warn when .warn() is called", function () {
      logger.warn("test message");

      assert.strictEqual(warnStub.calledOnce, true);
      assert.strictEqual(warnStub.firstCall.args[0], "[test] test message");
    });

    it("should call EXTENSION_OUTPUT_CHANNEL.error when .error() is called", function () {
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

  // constants for testing RotatingLogManager and RotatingLogOutputChannel
  const TEST_BASEPATH = "test-base-path";

  describe("RotatingLogManager", () => {
    let instance: RotatingLogManager;

    beforeEach(() => {
      // create new RotatingLogManager instance for each test
      instance = new RotatingLogManager(TEST_BASEPATH);
    });

    afterEach(() => {
      instance.dispose();
    });

    describe("rotatingFilenameGenerator", () => {
      it("should instantiate with empty _rotatedFileNames", function () {
        const fileName = instance.rotatingFilenameGenerator(new Date(), 0);
        const currentFileName = instance["_currentFileName"];
        const rotatedFileNames = instance["_rotatedFileNames"];

        assert.strictEqual(fileName, `${BASEFILE_PREFIX}-${TEST_BASEPATH}.log`);
        // no rotations yet
        assert.strictEqual(rotatedFileNames.length, 0);
        assert.strictEqual(currentFileName, `${BASEFILE_PREFIX}-${TEST_BASEPATH}.log`);
      });

      it("should generate filename without index", function () {
        const filename = instance.rotatingFilenameGenerator(new Date());

        assert.strictEqual(filename, `${BASEFILE_PREFIX}-${TEST_BASEPATH}.log`);
      });

      it("should generate a new filename with a higher index", function () {
        const fileName1 = instance.rotatingFilenameGenerator(new Date(), 1);
        const fileName2 = instance.rotatingFilenameGenerator(new Date(), 2);
        const currentFileName = instance["_currentFileName"];
        const rotatedFileNames = instance["_rotatedFileNames"];

        assert.strictEqual(fileName1, `${BASEFILE_PREFIX}-${TEST_BASEPATH}.1.log`);
        assert.strictEqual(fileName2, `${BASEFILE_PREFIX}-${TEST_BASEPATH}.2.log`);
        // one rotated file, current left alone
        assert.strictEqual(rotatedFileNames.length, 2);
        assert.strictEqual(rotatedFileNames[0], `${BASEFILE_PREFIX}-${TEST_BASEPATH}.1.log`);
        assert.strictEqual(rotatedFileNames[1], `${BASEFILE_PREFIX}-${TEST_BASEPATH}.2.log`);
        assert.strictEqual(currentFileName, `${BASEFILE_PREFIX}-${TEST_BASEPATH}.log`);
      });

      it("should limit rotated file names to MAX_LOGFILES", function () {
        const rotatedFileNames = instance["_rotatedFileNames"];
        for (let i = 1; i <= MAX_LOGFILES + 2; i++) {
          instance.rotatingFilenameGenerator(new Date(), i);
        }

        assert.strictEqual(rotatedFileNames.length, MAX_LOGFILES);
      });
    });

    describe("getStream()", () => {
      it("should create a new stream if one doesn't exist", function () {
        // ensure we start with no existing stream
        assert.strictEqual(instance["stream"], undefined);

        const stream = instance.getStream();

        // check that stream is created and has expected properties
        assert.ok(stream, "Stream should be created");
        // check that the stream is stored internally
        assert.strictEqual(instance["stream"], stream);
        // check that stream is not closed initially
        assert.strictEqual(stream.closed, false, "New stream should not be closed");
      });

      it("should return existing stream on subsequent calls", function () {
        const stream1 = instance.getStream();
        const stream2 = instance.getStream();

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

        const fileUris = instance.getFileUris();

        assert.strictEqual(fileUris.length, 1);
        assert.ok(fileUris[0].fsPath.includes(`${BASEFILE_PREFIX}-${TEST_BASEPATH}.log`));
        sinon.assert.calledOnce(writeableTmpDirStub);
      });

      it("should return current and rotated file URIs when rotated files exist", () => {
        // generate some rotated files by calling the filename generator
        instance.rotatingFilenameGenerator(new Date(), 1);
        instance.rotatingFilenameGenerator(new Date(), 2);

        // mock that all files exist
        existsSyncStub.returns(true);

        const fileUris = instance.getFileUris();

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
        instance.rotatingFilenameGenerator(new Date(), 1);
        instance.rotatingFilenameGenerator(new Date(), 2);

        // mock that only current file and first rotated file exist
        existsSyncStub.callsFake((uri: Uri) => {
          return !uri.fsPath.includes(".2.log");
        });

        const fileUris = instance.getFileUris();

        assert.strictEqual(fileUris.length, 2);

        // check that .2.log file is not included
        const missingFile = fileUris.find((uri) => uri.fsPath.includes(".2.log"));
        assert.strictEqual(missingFile, undefined, "Non-existent file should not be included");
      });

      it("should return empty array when no files exist", () => {
        // mock that no files exist
        existsSyncStub.returns(false);

        const fileUris = instance.getFileUris();

        assert.strictEqual(fileUris.length, 0);
      });

      it("should return current file + MAX_LOGFILES rotated files", () => {
        // generate maximum number of rotated files
        for (let i = 1; i <= MAX_LOGFILES + 2; i++) {
          instance.rotatingFilenameGenerator(new Date(), i);
        }

        existsSyncStub.returns(true);

        const fileUris = instance.getFileUris();

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
    let infoStub: sinon.SinonStub;

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
      instance = new RotatingLogOutputChannel(TEST_CHANNELNAME, TEST_BASEPATH, TEST_CONSOLENAME);

      // stub rotating log output channel methods
      outputChannelStub = instance["outputChannel"];

      infoStub = sandbox.stub(outputChannelStub, "info");

      // stub rotating log manager methods
      logManagerStub = instance["rotatingLogManager"];

      streamStub = sinon.createStubInstance(RotatingFileStream);
      sandbox.stub(logManagerStub, "getStream").returns(streamStub);
    });

    afterEach(function () {
      instance.dispose();
    });

    it("should get name from member outputChannel", () => {
      assert.strictEqual(instance.name, outputChannelStub.name);
    });

    it("should get logLevel from member outputChannel", () => {
      assert.strictEqual(instance.logLevel, outputChannelStub.logLevel);
    });

    it("should get onDidChangeLogLevel from member outputChannel", () => {
      assert.strictEqual(instance.onDidChangeLogLevel, outputChannelStub.onDidChangeLogLevel);
    });

    it("should handle trace method", () => {
      const traceStub = sandbox.stub(outputChannelStub, "trace");
      instance.trace("test message");
      // stream should not be called for trace logs and writeToLogFile() should not be called because it's too verbose
      sinon.assert.notCalled(streamStub.write);

      sinon.assert.calledOnce(traceStub);
      sinon.assert.calledWith(traceStub, `test message`);
    });

    it("should handle debug method", () => {
      const debugStub = sandbox.stub(outputChannelStub, "debug");
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
      const warnStub = sandbox.stub(outputChannelStub, "warn");
      instance.warn("warn message");
      // warn logs should be written to the stream with writeToLogFile()
      sinon.assert.calledOnce(streamStub.write);

      sinon.assert.calledOnce(warnStub);
      sinon.assert.calledWith(warnStub, `warn message`);
    });

    it("should handle error method", () => {
      const errorStub = sandbox.stub(outputChannelStub, "error");
      instance.error("error message");
      // error logs should be written to the stream with writeToLogFile()
      sinon.assert.calledOnce(streamStub.write);

      sinon.assert.calledOnce(errorStub);
      sinon.assert.calledWith(errorStub, `error message`);
    });

    it("should handle append method", () => {
      const appendStub = sandbox.stub(outputChannelStub, "append");
      instance.append("append message");
      // append logs should be written to the stream with writeToLogFile()
      sinon.assert.calledOnce(streamStub.write);

      sinon.assert.calledOnce(appendStub);
      sinon.assert.calledWith(appendStub, "append message");
    });

    it("should handle appendLine method", () => {
      const appendLineStub = sandbox.stub(outputChannelStub, "appendLine");
      instance.appendLine("appendLine message");
      // appendLine logs should be written to the stream with writeToLogFile()
      sinon.assert.calledOnce(streamStub.write);

      sinon.assert.calledOnce(appendLineStub);
      sinon.assert.calledWith(appendLineStub, "appendLine message");
    });

    it("should handle replace method", () => {
      const replaceStub = sandbox.stub(outputChannelStub, "replace");
      instance.replace("replace message");
      // replace logs should be written to the stream with writeToLogFile()
      sinon.assert.calledOnce(streamStub.write);

      sinon.assert.calledOnce(replaceStub);
      sinon.assert.calledWith(replaceStub, "replace message");
    });

    it("should handle clear method", () => {
      const clearStub = sandbox.stub(outputChannelStub, "clear");
      instance.clear();
      sinon.assert.calledOnce(clearStub);
    });

    it("should handle hide method", () => {
      const hideStub = sandbox.stub(outputChannelStub, "hide");
      instance.hide();
      sinon.assert.calledOnce(hideStub);
    });

    it("should handle show method", () => {
      const showStub = sandbox.stub(outputChannelStub, "show");
      instance.show();
      sinon.assert.calledOnce(showStub);
    });

    it("should delegate getFileUris() to member RotatingLogManager instance", function () {
      const getFileUrisStub = sinon.stub(logManagerStub, "getFileUris");

      instance.getFileUris();

      // check that getFileUris() is called
      sinon.assert.calledOnce(getFileUrisStub);
    });
  });
});
