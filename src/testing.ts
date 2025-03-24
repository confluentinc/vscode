import { writeFile } from "fs/promises";
import { globSync } from "glob";
import Mocha from "mocha";
import { join, resolve } from "path";
import { getTestExtensionContext } from "../tests/unit/testUtils";

export async function run() {
  // Unix cwd is ___/vscode, but on Windows it's ___/vscode/.vscode-test/<archive>/
  // so we're going off of __dirname which is ___/vscode/out/src for both
  const projectRoot = resolve(__dirname, "../..");
  const resultFilePath = join(projectRoot, "TEST-result.xml");
  console.log(`Writing test results to "${resultFilePath}"`);

  const version = process.env.VSCODE_VERSION ?? "stable";
  const mocha = new Mocha({
    color: true,
    ui: "bdd",
    timeout: process.env.CI !== null ? 30_000 : 10_000,
    reporter: "mocha-multi-reporters",
    reporterOptions: {
      reporterEnabled: "spec, mocha-junit-reporter",
      mochaJunitReporterReporterOptions: {
        testsuitesTitle: `VS Code (${version}) Extension Tests: Mocha (${process.platform} ${process.arch})`,
        mochaFile: resultFilePath,
      },
    },
  });

  const testsRoot = resolve(__dirname, ".");
  const files = globSync("./**/*.test.js", { cwd: testsRoot });
  for (const f of files) mocha.addFile(resolve(testsRoot, f));

  // the environment may provide filter string
  if (process.env.FGREP != null) {
    mocha.fgrep(process.env.FGREP);
  }

  mocha.suite.beforeAll("Global suite setup", globalBeforeAll);
  // mocha.suite.beforeEach("Global individual setup", globalBeforeEach);

  const failures = await new Promise<number>((resolve) => mocha.run(resolve));
  if (failures > 0) throw new Error(`${failures} tests failed.`);
  // @ts-expect-error __coverage__ is what istanbul uses for storing coverage data
  const coverageData = global.__coverage__ ?? null;
  if (coverageData != null) {
    // same handline as resultFilePath above
    const coverageFilePath = join(projectRoot, "coverage.json");
    await writeFile(coverageFilePath, JSON.stringify(coverageData));
  }
}

async function globalBeforeAll() {
  console.log("Global test suite setup");

  // smoke-test to make sure we can set up the environment for tests by activating the extension:
  // - set the extension context
  // - start the sidecar process
  console.log(
    "Activating the extension, setting extension context, and attempting to start the sidecar...",
  );
  await getTestExtensionContext();
  // if this fails, it will throw and we'll see something like:
  // 1) "before all" hook: Global suite setup in "{root}":
  //    Activating extension 'confluentinc.vscode-confluent' failed: ...

  // otherwise, we should see this log line and tests should continue:
  console.log("✅ Test environment is ready. Running tests...");
}
