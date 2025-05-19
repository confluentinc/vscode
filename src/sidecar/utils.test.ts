import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as sinon from "sinon";
import { Uri } from "vscode";
import * as fsWrappers from "../utils/fsWrappers";
import * as sidecarLogging from "./logging";
import { SidecarOutputs, SidecarStartupFailureReason } from "./types";
import { divineSidecarStartupFailureReason, gatherSidecarOutputs } from "./utils";

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

      sandbox.stub(fsWrappers, "readFile").callsFake(async (uri: Uri) => {
        const filePath = uri.fsPath;
        return fs.readFileSync(filePath, "utf8");
      });

      return stderrPath;
    }

    it("should read happy logs and empty stderr", async () => {
      // Has 11 parseable log lines, 1 degenerate stderr line
      const stderrPath = useFixture("clean");
      const result = await gatherSidecarOutputs(stderrPath);
      assert.strictEqual(result.logLines.length, 11);
      assert.strictEqual(result.parsedLogLines.length, 11);

      assert.strictEqual(result.stderrLines.length, 0);
    });
  });
});
