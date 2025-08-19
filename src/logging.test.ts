import * as assert from "assert";
import sinon from "sinon";
import * as fsWrappers from "./utils/fsWrappers";
import { WriteableTmpDir } from "./utils/file";
import { Uri } from "vscode";
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

describe("logging.ts Logger methods", function () {
  let sandbox: sinon.SinonSandbox;

  let traceStub: sinon.SinonStub;
  let debugStub: sinon.SinonStub;
  let infoStub: sinon.SinonStub;
  let warnStub: sinon.SinonStub;
  let errorStub: sinon.SinonStub;

  let logger: Logger;

  beforeEach(function () {
    sandbox = sinon.createSandbox();

    // stub output channel methods
    traceStub = sandbox.stub(OUTPUT_CHANNEL, "trace");
    debugStub = sandbox.stub(OUTPUT_CHANNEL, "debug");
    infoStub = sandbox.stub(OUTPUT_CHANNEL, "info");
    warnStub = sandbox.stub(OUTPUT_CHANNEL, "warn");
    errorStub = sandbox.stub(OUTPUT_CHANNEL, "error");

    // create a new logger instance for each test
    logger = new Logger("test");
  });

  afterEach(function () {
    sandbox.restore();
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

describe("logging.ts rotatingFilenameGenerator", function () {
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
const TEST_CHANNELNAME = "test-channel-name";
const TEST_CONSOLENAME = "test-console-name";

describe("logging.ts RotatingLogManager", function () {
  let sandbox: sinon.SinonSandbox;
  let logManager: RotatingLogManager;

  let existsSyncStub: sinon.SinonStub;
  let writeableTmpDirStub: sinon.SinonStub;

  beforeEach(function () {
    sandbox = sinon.createSandbox();

    // create new RotatingLogManager instance for each test
    logManager = new RotatingLogManager(TEST_BASEPATH);
  });

  afterEach(function () {
    logManager.dispose();
    sandbox.restore();
  });

  it("should instantiate with empty _rotatedFileNames", function () {
    const fileName = logManager.rotatingFilenameGenerator(new Date(), 0);
    const currentFileName = (logManager as any)._currentFileName;
    const rotatedFileNames = (logManager as any)._rotatedFileNames;

    assert.strictEqual(fileName, `${BASEFILE_PREFIX}-${TEST_BASEPATH}.log`);
    // no rotations yet
    assert.strictEqual(rotatedFileNames.length, 0);
    assert.strictEqual(currentFileName, `${BASEFILE_PREFIX}-${TEST_BASEPATH}.log`);
  });

  it("should generate filename without index", function () {
    const filename = logManager.rotatingFilenameGenerator(new Date());

    assert.strictEqual(filename, `${BASEFILE_PREFIX}-${TEST_BASEPATH}.log`);
  });

  it("should generate a new filename with a higher index", function () {
    const fileName1 = logManager.rotatingFilenameGenerator(new Date(), 1);
    const fileName2 = logManager.rotatingFilenameGenerator(new Date(), 2);
    const currentFileName = (logManager as any)._currentFileName;
    const rotatedFileNames = (logManager as any)._rotatedFileNames;

    assert.strictEqual(fileName1, `${BASEFILE_PREFIX}-${TEST_BASEPATH}.1.log`);
    assert.strictEqual(fileName2, `${BASEFILE_PREFIX}-${TEST_BASEPATH}.2.log`);
    // one rotated file, current left alone
    assert.strictEqual(rotatedFileNames.length, 2);
    assert.strictEqual(rotatedFileNames[0], `${BASEFILE_PREFIX}-${TEST_BASEPATH}.1.log`);
    assert.strictEqual(rotatedFileNames[1], `${BASEFILE_PREFIX}-${TEST_BASEPATH}.2.log`);
    assert.strictEqual(currentFileName, `${BASEFILE_PREFIX}-${TEST_BASEPATH}.log`);
  });

  it("should limit rotated file names to MAX_LOGFILES", function () {
    const rotatedFileNames = (logManager as any)._rotatedFileNames;
    for (let i = 1; i <= MAX_LOGFILES + 2; i++) {
      logManager.rotatingFilenameGenerator(new Date(), i);
    }

    assert.strictEqual(rotatedFileNames.length, MAX_LOGFILES);
  });

  it("should return existing stream on subsequent calls", function () {
    const stream1 = logManager.getStream();
    const stream2 = logManager.getStream();

    assert.strictEqual(stream1, stream2);
  });

  describe("getFileUris", function () {
    it("should return only current file URI when no rotated files exist", function () {
      // create stubs for existsSync and writeableTmpDir to mock creating files on disk
      existsSyncStub = sandbox.stub(fsWrappers, "existsSync");
      writeableTmpDirStub = sandbox.stub(WriteableTmpDir.getInstance(), "get").returns("/test/dir");
      // mock that only the current file exists
      existsSyncStub.callsFake((uri: Uri) => {
        return uri.fsPath.includes(`${BASEFILE_PREFIX}-${TEST_BASEPATH}.log`);
      });

      const fileUris = logManager.getFileUris();

      assert.strictEqual(fileUris.length, 1);
      assert.ok(fileUris[0].fsPath.includes(`${BASEFILE_PREFIX}-${TEST_BASEPATH}.log`));
      assert.strictEqual(writeableTmpDirStub.calledOnce, true);
    });

    it("should return current and rotated file URIs when rotated files exist", function () {
      // create stubs for existsSync and writeableTmpDir to mock creating files on disk
      existsSyncStub = sandbox.stub(fsWrappers, "existsSync");
      // generate some rotated files by calling the filename generator
      logManager.rotatingFilenameGenerator(new Date(), 1);
      logManager.rotatingFilenameGenerator(new Date(), 2);

      // mock that all files exist
      existsSyncStub.returns(true);

      const fileUris = logManager.getFileUris();

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

    it("should filter out non-existent files", function () {
      // create stubs for existsSync and writeableTmpDir to mock creating files on disk
      existsSyncStub = sandbox.stub(fsWrappers, "existsSync");

      // generate some rotated files
      logManager.rotatingFilenameGenerator(new Date(), 1);
      logManager.rotatingFilenameGenerator(new Date(), 2);

      // mock that only current file and first rotated file exist
      existsSyncStub.callsFake((uri: Uri) => {
        return !uri.fsPath.includes(".2.log");
      });

      const fileUris = logManager.getFileUris();

      assert.strictEqual(fileUris.length, 2);

      // check that .2.log file is not included
      const missingFile = fileUris.find((uri) => uri.fsPath.includes(".2.log"));
      assert.strictEqual(missingFile, undefined, "Non-existent file should not be included");
    });

    it("should return empty array when no files exist", function () {
      // create stubs for existsSync and writeableTmpDir to mock creating files on disk
      existsSyncStub = sandbox.stub(fsWrappers, "existsSync");

      // mock that no files exist
      existsSyncStub.returns(false);

      const fileUris = logManager.getFileUris();

      assert.strictEqual(fileUris.length, 0);
    });

    it("should handle maximum number of rotated files", function () {
      // create stubs for existsSync and writeableTmpDir to mock creating files on disk
      existsSyncStub = sandbox.stub(fsWrappers, "existsSync");
      // generate maximum number of rotated files
      for (let i = 1; i <= MAX_LOGFILES + 2; i++) {
        logManager.rotatingFilenameGenerator(new Date(), i);
      }

      existsSyncStub.returns(true);

      const fileUris = logManager.getFileUris();

      // should have current file + MAX_LOGFILES rotated files
      assert.strictEqual(fileUris.length, MAX_LOGFILES + 1);
    });
  });
});

describe("logging.ts RotatingLogOutputChannel", function () {
  let sandbox: sinon.SinonSandbox;

  let traceStub: sinon.SinonStub;
  let debugStub: sinon.SinonStub;
  let infoStub: sinon.SinonStub;
  let warnStub: sinon.SinonStub;
  let errorStub: sinon.SinonStub;
  let appendStub: sinon.SinonStub;
  let appendLineStub: sinon.SinonStub;
  let replaceStub: sinon.SinonStub;
  let existsSyncStub: sinon.SinonStub;
  let writeableTmpDirStub: sinon.SinonStub;

  let logOutputChannel: RotatingLogOutputChannel;

  beforeEach(function () {
    sandbox = sinon.createSandbox();

    // create new rotating log output channel instance for each test
    logOutputChannel = new RotatingLogOutputChannel(
      TEST_CHANNELNAME,
      TEST_BASEPATH,
      TEST_CONSOLENAME,
    );

    // stub rotating log output channel methods
    const outputChannel = (logOutputChannel as any).outputChannel;

    traceStub = sandbox.stub(outputChannel, "trace");
    debugStub = sandbox.stub(outputChannel, "debug");
    infoStub = sandbox.stub(outputChannel, "info");
    warnStub = sandbox.stub(outputChannel, "warn");
    errorStub = sandbox.stub(outputChannel, "error");
    appendStub = sandbox.stub(outputChannel, "append");
    appendLineStub = sandbox.stub(outputChannel, "appendLine");
    replaceStub = sandbox.stub(outputChannel, "replace");
  });

  afterEach(function () {
    logOutputChannel.dispose();
    sandbox.restore();
  });

  it("should handle trace method", function () {
    logOutputChannel.trace("test message");

    assert.strictEqual(traceStub.calledOnce, true);
    assert.strictEqual(traceStub.firstCall.args[0], `test message`);
  });

  it("should handle info method", function () {
    logOutputChannel.info("info message");

    assert.strictEqual(infoStub.calledOnce, true);
    console.log(infoStub.firstCall.args[0]);
    assert.strictEqual(infoStub.firstCall.args[0], `info message`);
  });

  it("should handle error method", function () {
    logOutputChannel.error("error message");

    assert.strictEqual(errorStub.calledOnce, true);
    assert.strictEqual(errorStub.firstCall.args[0], `error message`);
  });

  it("should handle warn method", function () {
    logOutputChannel.warn("warn message");

    assert.strictEqual(warnStub.calledOnce, true);
    assert.strictEqual(warnStub.firstCall.args[0], `warn message`);
  });

  it("should handle debug method", function () {
    logOutputChannel.debug("debug message");

    assert.strictEqual(debugStub.calledOnce, true);
    assert.strictEqual(debugStub.firstCall.args[0], `debug message`);
  });

  it("should handle append method", function () {
    logOutputChannel.append("append message");

    assert.strictEqual(appendStub.calledOnce, true);
    assert.strictEqual(appendStub.firstCall.args[0], "append message");
  });

  it("should handle appendLine method", function () {
    logOutputChannel.appendLine("appendLine message");

    assert.strictEqual(appendLineStub.calledOnce, true);
    assert.strictEqual(appendLineStub.firstCall.args[0], "appendLine message");
  });

  it("should handle replace method", function () {
    logOutputChannel.replace("replace message");

    assert.strictEqual(replaceStub.calledOnce, true);
    assert.strictEqual(replaceStub.firstCall.args[0], "replace message");
  });

  it("should delegate getFileUris() method", function () {
    existsSyncStub = sandbox.stub(fsWrappers, "existsSync");
    writeableTmpDirStub = sandbox.stub(WriteableTmpDir.getInstance(), "get").returns("/test/dir");
    // generate some rotated files to have URIs to return
    const rotatingLogManager = (logOutputChannel as any).rotatingLogManager;
    rotatingLogManager.rotatingFilenameGenerator(new Date(), 1);

    existsSyncStub.returns(true);

    const fileUris = logOutputChannel.getFileUris();

    assert.strictEqual(existsSyncStub.called, true);
    assert.strictEqual(writeableTmpDirStub.called, true);
    assert.ok(Array.isArray(fileUris), "Should return an array of URIs");
    assert.strictEqual(fileUris.length, 2); // current + 1 rotated file
    assert.ok(fileUris[0].fsPath.includes(`${BASEFILE_PREFIX}-${TEST_BASEPATH}.log`));
    assert.ok(fileUris[1].fsPath.includes(`${BASEFILE_PREFIX}-${TEST_BASEPATH}.1.log`));
  });
});
