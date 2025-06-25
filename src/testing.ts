import { writeFile } from "fs/promises";
import { globSync } from "glob";
import Mocha from "mocha";
import { join, resolve } from "path";
import { getTestExtensionContext } from "../tests/unit/testUtils";
import { GlobalStorageKeys, SecretStorageKeys, WorkspaceStorageKeys } from "./storage/constants";
import { GeneratedKeyResourceType } from "./storage/resourceManager";
import { getGlobalState, getSecretStorage, getWorkspaceState } from "./storage/utils";

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
    timeout: process.env.CI != null ? 30_000 : 10_000,
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
  mocha.suite.beforeEach("Clear extension state before each test", globalBeforeEach);

  mocha.suite.afterEach("Clear extension state after each test", globalAfterEach);

  const failures = await new Promise<number>((resolve) => mocha.run(resolve));
  if (failures > 0) throw new Error(`${failures} tests failed.`);
  // @ts-expect-error __coverage__ is what istanbul uses for storing coverage data
  const coverageData = global.__coverage__ ?? null;
  if (coverageData != null) {
    // same handling as resultFilePath above
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

async function globalBeforeEach() {
  console.log("Running global beforeEach setup for test suite...");
  // for now, we just clear the extension state, but we could add more setup here if needed
  await resetExtensionState();
}

async function globalAfterEach() {
  console.log("Running global afterEach cleanup for test suite...");
  // for now, we just clear the extension state, but we could add more cleanup here if needed
  await resetExtensionState();
}

/**
 * Clear all extension-related state from VS Code storage to prevent test contamination.
 * This ensures each test starts with a clean slate.
 */
async function resetExtensionState(): Promise<void> {
  try {
    // Clear all workspace state keys
    const workspaceState = getWorkspaceState();
    for (const key of Object.values(WorkspaceStorageKeys)) {
      await workspaceState.update(key, undefined);
    }

    // Clear all global state keys
    const globalState = getGlobalState();
    for (const key of Object.values(GlobalStorageKeys)) {
      await globalState.update(key, undefined);
    }

    // Clear all secret storage keys
    const secretStorage = getSecretStorage();
    for (const key of Object.values(SecretStorageKeys)) {
      await secretStorage.delete(key);
    }

    // Also clear any dynamically generated keys by getting all keys and clearing extension-related ones
    const allWorkspaceKeys = workspaceState.keys();
    const allGlobalKeys = globalState.keys();

    // Clear any dynamically generated workspace keys (format: connectionId-resourceType)
    const resourceTypeSuffixes = Object.values(GeneratedKeyResourceType);
    const workspacePromises = allWorkspaceKeys
      .filter(
        (key) =>
          key.startsWith("confluent.") ||
          resourceTypeSuffixes.some((suffix) => key.endsWith(`-${suffix}`)),
      )
      .map((key) => workspaceState.update(key, undefined));

    // Clear any other global keys that might be dynamically generated
    const globalPromises = allGlobalKeys
      .filter((key) => key.startsWith("confluent."))
      .map((key) => globalState.update(key, undefined));

    await Promise.all([...workspacePromises, ...globalPromises]);
  } catch (error) {
    // Don't fail tests if state cleanup fails, but log it
    console.warn("Warning: Failed to clear extension state:", error);
  }
}
