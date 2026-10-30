import { NodeClient } from "@sentry/node";
import * as assert from "assert";
import * as inspector from "inspector";
import { Module } from "module";
import { buildSentryClientOptions, getExtensionHostSafeIntegrations } from "./sentryClient";

// Changes require verifying that integration setup has no process-wide effects.
const APPROVED_INTEGRATIONS: string[] = [
  "EventFilters",
  "LinkedErrors",
  "NodeSystemError",
  "Context",
  "RewriteFrames",
];

interface GlobalsSnapshot {
  moduleRequire: typeof Module.prototype.require;
  functionToString: typeof Function.prototype.toString;
  errorPrepareStackTrace: typeof Error.prepareStackTrace;
  processListenerCounts: number[];
  inspectorUrl: string | undefined;
}

const OBSERVED_PROCESS_EVENTS: string[] = [
  "uncaughtException",
  "unhandledRejection",
  "exit",
  "beforeExit",
  "warning",
];

function snapshotGlobals(): GlobalsSnapshot {
  return {
    moduleRequire: Module.prototype.require,
    functionToString: Function.prototype.toString,
    errorPrepareStackTrace: Error.prepareStackTrace,
    processListenerCounts: OBSERVED_PROCESS_EVENTS.map((event) => process.listenerCount(event)),
    inspectorUrl: inspector.url(),
  };
}

function assertGlobalsUnchanged(before: GlobalsSnapshot, after: GlobalsSnapshot): void {
  assert.strictEqual(
    after.moduleRequire,
    before.moduleRequire,
    "Module.prototype.require was patched, which slows down require() for every extension",
  );
  assert.strictEqual(
    after.functionToString,
    before.functionToString,
    "Function.prototype.toString was patched process-wide",
  );
  assert.strictEqual(
    after.errorPrepareStackTrace,
    before.errorPrepareStackTrace,
    "Error.prepareStackTrace was patched process-wide",
  );
  assert.deepStrictEqual(
    after.processListenerCounts,
    before.processListenerCounts,
    `process-level listeners were added for ${OBSERVED_PROCESS_EVENTS.join("/")}`,
  );
  assert.strictEqual(
    after.inspectorUrl,
    before.inspectorUrl,
    "a node:inspector session was opened against the shared extension host",
  );
}

describe("telemetry/sentryClient.ts getExtensionHostSafeIntegrations()", () => {
  it("should enable exactly the approved integrations, in order", () => {
    const names: string[] = getExtensionHostSafeIntegrations().map(
      (integration) => integration.name,
    );

    assert.deepStrictEqual(
      names,
      APPROVED_INTEGRATIONS,
      "the Sentry integration list changed; verify the new set leaves process globals untouched and update APPROVED_INTEGRATIONS",
    );
  });
});

describe("telemetry/sentryClient.ts buildSentryClientOptions()", () => {
  it("should not opt into local variable capture or ESM loader hooks", () => {
    const options = buildSentryClientOptions();

    assert.strictEqual(options.includeLocalVariables, false);
    assert.strictEqual(options.registerEsmLoaderHooks, false);
  });

  it("should leave extension host globals untouched while initialized and after closing", async () => {
    const before: GlobalsSnapshot = snapshotGlobals();
    // A valid DSN ensures integrations initialize without sending data.
    const client = new NodeClient({
      ...buildSentryClientOptions(),
      dsn: "https://testkey@o0.ingest.us.sentry.io/1",
      transport: () => ({
        send: () => Promise.resolve({}),
        flush: () => Promise.resolve(true),
      }),
    });

    try {
      client.init();
      // Allow asynchronous integration setup to settle.
      await new Promise((resolve) => setTimeout(resolve, 500));
      assertGlobalsUnchanged(before, snapshotGlobals());
    } finally {
      await client.close(1000);
    }

    assertGlobalsUnchanged(before, snapshotGlobals());
  });
});
