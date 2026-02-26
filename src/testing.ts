import { writeFile } from "fs/promises";
import { globSync } from "glob";
import Mocha from "mocha";
import { join, resolve } from "path";
import { mochaGlobalSetup } from "../tests/unit/globalSetup";

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
  if (failures > 0) throw new Error(`${failures} tests failed.`);
}
