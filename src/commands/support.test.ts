import * as assert from "assert";
import { normalize } from "path";
import * as sinon from "sinon";
import { Uri } from "vscode";
import * as logging from "../logging";
import { SIDECAR_LOGFILE_PATH } from "../sidecar/constants";
import { extensionLogFileUris, sidecarLogFileUri } from "./support";

describe("commands/support.ts", function () {
  let sandbox: sinon.SinonSandbox;

  const currentLogfile = "vscode-confluent-123.log";

  beforeEach(function () {
    sandbox = sinon.createSandbox();

    sandbox.stub(logging, "CURRENT_LOGFILE_NAME").value(currentLogfile);
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("extensionLogFileUris() should return URIs for all log files without duplicates", function () {
    const rotatedLogFiles = [currentLogfile, "vscode-confluent-456.log"];
    sandbox.stub(logging, "ROTATED_LOGFILE_NAMES").value(rotatedLogFiles);

    const logFileUris: Uri[] = extensionLogFileUris();

    // two results since the current log file is included in the rotated log files
    assert.strictEqual(logFileUris.length, rotatedLogFiles.length);
    assert.strictEqual(logFileUris[0].path.includes(logging.CURRENT_LOGFILE_NAME), true);
    assert.strictEqual(logFileUris[1].path.includes(rotatedLogFiles[1]), true);
  });

  it("extensionLogFileUris() should return the correct URIs when CURRENT_LOGFILE_NAME isn't in ROTATED_LOGFILE_NAMES", function () {
    const rotatedLogFiles = ["vscode-confluent-456.log", "vscode-confluent-789.log"];
    sandbox.stub(logging, "ROTATED_LOGFILE_NAMES").value(rotatedLogFiles);

    const logFileUris: Uri[] = extensionLogFileUris();

    // three results since the current log file isn't included in the rotated log files
    assert.strictEqual(logFileUris.length, rotatedLogFiles.length + 1);
    assert.strictEqual(logFileUris[0].path.includes(logging.CURRENT_LOGFILE_NAME), true);
    assert.strictEqual(logFileUris[1].path.includes(rotatedLogFiles[0]), true);
    assert.strictEqual(logFileUris[2].path.includes(rotatedLogFiles[1]), true);
  });

  it("sidecarLogFileUri() should return the correct URI for the sidecar log file", function () {
    const logFileUri: Uri = sidecarLogFileUri();

    // normalized to adjust slashes for Windows vs Unix
    assert.strictEqual(logFileUri.path, Uri.file(normalize(SIDECAR_LOGFILE_PATH)).path);
  });
});
