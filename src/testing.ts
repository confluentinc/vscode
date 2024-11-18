import { writeFile } from "fs/promises";
import { globSync } from "glob";
import Mocha from "mocha";
import { resolve } from "path";
import { constructResourceLoaderSingletons } from "./storage/resourceLoaderInitialization";

export async function run() {
  const mocha = new Mocha({
    color: true,
    ui: "bdd",
    timeout: 10_000,
    reporter: "mocha-multi-reporters",
    reporterOptions: {
      reporterEnabled: "spec, mocha-junit-reporter",
      mochaJunitReporterReporterOptions: {
        mochaFile: "TEST-result.xml",
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
    await writeFile("./coverage.json", JSON.stringify(coverageData));
  }
}

function globalBeforeAll() {
  console.log("Global test suite setup");

  // Ensure the resource loaders are constructed and registered before running tests.

  constructResourceLoaderSingletons();
}
