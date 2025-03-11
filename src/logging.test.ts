import * as assert from "assert";
import sinon from "sinon";
import {
  CURRENT_LOGFILE_NAME,
  Logger,
  MAX_LOGFILES,
  OUTPUT_CHANNEL,
  ROTATED_LOGFILE_NAMES,
  rotatingFilenameGenerator,
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
