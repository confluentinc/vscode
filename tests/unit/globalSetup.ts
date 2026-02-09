import { getTestExtensionContext } from "./testUtils";

/** Mocha global "before all"-style setup hook for @vscode/test-cli and `src/testing.ts`. */
export async function mochaGlobalSetup(): Promise<void> {
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
