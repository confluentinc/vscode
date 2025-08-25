import * as assert from "assert";
import { normalize } from "path";
import * as sinon from "sinon";
import { Uri } from "vscode";
import { getSidecarLogfilePath } from "../sidecar/logging";
import { sidecarLogFileUri } from "./support";

describe("commands/support.ts", function () {
  let sandbox: sinon.SinonSandbox;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("sidecarLogFileUri() should return the correct URI for the sidecar log file", function () {
    const logFileUri: Uri = sidecarLogFileUri();
    const logfilePath = getSidecarLogfilePath();

    // normalized to adjust slashes for Windows vs Unix
    assert.strictEqual(logFileUri.path, Uri.file(normalize(logfilePath)).path);
  });
});
