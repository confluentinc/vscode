import { copyFileSync, existsSync as fsExistsSync } from "fs";
import { writeFile } from "fs/promises";
import { globSync } from "glob";
import Mocha from "mocha";
import { join, resolve } from "path";
import { mochaGlobalSetup } from "../tests/unit/globalSetup";
import { EXTENSION_OUTPUT_CHANNEL } from "./logging";
import { getSidecarFormattedLogfilePath } from "./sidecar/logging";

export async function run() {
  // Unix cwd is ___/vscode, but on Windows it's ___/vscode/.vscode-test/<archive>/
  // so we're going off of __dirname which is ___/vscode/out/src for both
  const projectRoot = resolve(__dirname, "../..");
  const resultFilePath = join(projectRoot, "TEST-result.xml");
  console.log(`Writing test results to "${resultFilePath}"`);

  const version = process.env.VSCODE_VERSION ?? "stable";
  const mocha = new Mocha({
    color: true,
    forbidOnly: !!process.env.CI, // fail in CI if there are any .only tests
    ui: "bdd",
    timeout: process.env.CI ? 30_000 : 10_000,
    reporter: "mocha-multi-reporters",
    reporterOptions: {
      reporterEnabled: "spec, mocha-junit-reporter",
      // see https://www.npmjs.com/package/mocha-junit-reporter
      mochaJunitReporterReporterOptions: {
        testsuitesTitle: `VS Code (${version}) Extension Tests: Mocha (${process.platform} ${process.arch})`,
        mochaFile: resultFilePath,
        useFullSuiteTitle: true,
        rootSuiteTitle: `${version}:`,
      },
    },
  });

  const testsRoot = resolve(__dirname, ".");
  const files = globSync("./**/*.test.js", { cwd: testsRoot });
  for (const f of files) mocha.addFile(resolve(testsRoot, f));

  // the environment may provide a literal filter string (fixed-string/substring) or a grep pattern (regex)
  if (process.env.GREP != null) {
    try {
      mocha.grep(new RegExp(process.env.GREP));
    } catch {
      throw new Error(`Invalid GREP regex pattern: ${process.env.GREP}`);
    }
  } else if (process.env.FGREP != null) {
    mocha.fgrep(process.env.FGREP);
  }

  mocha.suite.beforeAll("Global suite setup", mochaGlobalSetup);

  const failures = await new Promise<number>((resolve) => mocha.run(resolve));
  // @ts-expect-error __coverage__ is what istanbul uses for storing coverage data
  const coverageData = global.__coverage__ ?? null;
  if (coverageData != null) {
    // same handling as resultFilePath above
    const coverageFilePath = join(projectRoot, "coverage.json");
    await writeFile(coverageFilePath, JSON.stringify(coverageData));
  }
  // copy extension+sidecar log files next to the test results XML for any test failure triage
  copyLogFilesToProjectRoot(projectRoot);

  if (failures > 0) throw new Error(`${failures} tests failed.`);
}

/** Copy extension and sidecar log files to the project root alongside TEST-result.xml. */
function copyLogFilesToProjectRoot(projectRoot: string): void {
  // resolve log file paths before disposing (dispose clears the stream reference)
  let extensionLogPath: string | undefined;
  try {
    const uris = EXTENSION_OUTPUT_CHANNEL.getFileUris();
    if (uris.length > 0) {
      extensionLogPath = uris[0].fsPath;
    }
  } catch {
    // getFileUris() may throw if WriteableTmpDir was never determined
    console.warn("Could not determine extension log file path; not copying log file");
  }

  // flush the rotating file stream so the copy captures all buffered writes
  EXTENSION_OUTPUT_CHANNEL.dispose();

  if (extensionLogPath) {
    try {
      const dest = join(projectRoot, "TEST-extension.log");
      copyFileSync(extensionLogPath, dest);
      console.log(`Copied extension log to "${dest}"`);
    } catch (err) {
      console.warn("Failed to copy extension log:", err);
    }
  }

  try {
    const sidecarLog = getSidecarFormattedLogfilePath();
    if (fsExistsSync(sidecarLog)) {
      const dest = join(projectRoot, "TEST-sidecar.log");
      copyFileSync(sidecarLog, dest);
      console.log(`Copied sidecar log to "${dest}"`);
    }
  } catch (err) {
    console.warn("Failed to copy sidecar log:", err);
  }
}
