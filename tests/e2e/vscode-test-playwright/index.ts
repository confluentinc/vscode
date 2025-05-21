import {
  _electron,
  test as base,
  TestInfo,
  TraceMode,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import {
  downloadAndUnzipVSCode,
  resolveCliArgsFromVSCodeExecutablePath,
} from "@vscode/test-electron";
import * as cp from "child_process";
import type { EventEmitter } from "events";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as readline from "readline";
import { fileURLToPath } from "url";
import { WebSocket } from "ws";
import {
  ObjectHandle,
  VSCode,
  VSCodeEvaluator,
  VSCodeFunctionOn,
  VSCodeHandle,
} from "./vscodeHandle";
export { expect } from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type VSCodeWorkerOptions = {
  vscodeVersion: string;
  extensions?: string | string[];
  vscodeTrace:
    | TraceMode
    | {
        mode: TraceMode;
        snapshots?: boolean;
        screenshots?: boolean;
        sources?: boolean;
        attachments?: boolean;
      };
};

export type VSCodeTestOptions = {
  extensionDevelopmentPath?: string;
  baseDir: string;
};

type VSCodeTestFixtures = {
  electronApp: ElectronApplication;
  workbox: Page;
  evaluateInVSCode<R>(vscodeFunction: VSCodeFunctionOn<VSCode, void, R>): Promise<R>;
  evaluateInVSCode<R, Arg>(vscodeFunction: VSCodeFunctionOn<VSCode, Arg, R>, arg: Arg): Promise<R>;
  evaluateHandleInVSCode<R>(
    vscodeFunction: VSCodeFunctionOn<VSCode, void, R>,
  ): Promise<VSCodeHandle<R>>;
  evaluateHandleInVSCode<R, Arg>(
    vscodeFunction: VSCodeFunctionOn<VSCode, Arg, R>,
    arg: Arg,
  ): Promise<VSCodeHandle<R>>;
};

type ExperimentalVSCodeTestFixtures = {
  _enableRecorder: void;
};

type InternalWorkerFixtures = {
  _createTempDir: () => Promise<string>;
  _vscodeInstall: { installPath: string; cachePath: string };
};

type InternalTestFixtures = {
  _evaluator: VSCodeEvaluator;
  _vscodeHandle: ObjectHandle<VSCode>;
};

function shouldCaptureTrace(traceMode: TraceMode, testInfo: TestInfo) {
  if (process.env.PW_TEST_DISABLE_TRACING) return false;

  if (traceMode === "on") return true;

  if (traceMode === "retain-on-failure") return true;

  if (traceMode === "on-first-retry" && testInfo.retry === 1) return true;

  if (traceMode === "on-all-retries" && testInfo.retry > 0) return true;

  if (traceMode === "retain-on-first-failure" && testInfo.retry === 0) return true;

  return false;
}

function getTraceMode(
  trace:
    | TraceMode
    | "retry-with-trace"
    | {
        mode: TraceMode;
        snapshots?: boolean;
        screenshots?: boolean;
        sources?: boolean;
        attachments?: boolean;
      },
) {
  const traceMode = typeof trace === "string" ? trace : trace.mode;
  if (traceMode === "retry-with-trace") return "on-first-retry";
  return traceMode;
}

// adapted from https://github.com/microsoft/playwright/blob/a6b320e36224f70ad04fd520503c230d5956ba66/packages/playwright-core/src/server/electron/electron.ts#L294-L320
function waitForLine(process: cp.ChildProcess, regex: RegExp): Promise<RegExpMatchArray> {
  function addEventListener(
    emitter: EventEmitter,
    eventName: string | symbol,
    handler: (...args: any[]) => void,
  ) {
    emitter.on(eventName, handler);
    return { emitter, eventName, handler };
  }

  function removeEventListeners(
    listeners: Array<{
      emitter: EventEmitter;
      eventName: string | symbol;
      handler: (...args: any[]) => void;
    }>,
  ) {
    for (const listener of listeners)
      listener.emitter.removeListener(listener.eventName, listener.handler);
    listeners.splice(0, listeners.length);
  }

  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: process.stderr! });
    const failError = new Error("Process failed to launch!");
    const listeners = [
      addEventListener(rl, "line", onLine),
      addEventListener(rl, "close", reject.bind(null, failError)),
      addEventListener(process, "exit", reject.bind(null, failError)),
      // It is Ok to remove error handler because we did not create process and there is another listener.
      addEventListener(process, "error", reject.bind(null, failError)),
    ];

    function onLine(line: string) {
      const match = line.match(regex);
      if (!match) return;
      cleanup();
      resolve(match);
    }

    function cleanup() {
      removeEventListeners(listeners);
    }
  });
}

export const test = base.extend<
  VSCodeTestFixtures & VSCodeTestOptions & InternalTestFixtures & ExperimentalVSCodeTestFixtures,
  VSCodeWorkerOptions & InternalWorkerFixtures
>({
  vscodeVersion: ["insiders", { option: true, scope: "worker" }],
  extensions: [undefined, { option: true, scope: "worker" }],
  vscodeTrace: ["off", { option: true, scope: "worker" }],
  extensionDevelopmentPath: [undefined, { option: true }],
  baseDir: [async ({ _createTempDir }, use) => await use(await _createTempDir()), { option: true }],

  _vscodeInstall: [
    async ({ _createTempDir, vscodeVersion, extensions }, use, workerInfo) => {
      const cachePath = await _createTempDir();
      const installBasePath = path.join(
        process.cwd(),
        ".vscode-test",
        `worker-${workerInfo.workerIndex}`,
      );
      await fs.promises.mkdir(installBasePath, { recursive: true });
      const installPath = await downloadAndUnzipVSCode({
        cachePath: installBasePath,
        version: vscodeVersion,
      });
      const [cliPath] = resolveCliArgsFromVSCodeExecutablePath(installPath);

      if (extensions) {
        await new Promise<void>((resolve, reject) => {
          extensions = typeof extensions === "string" ? [extensions] : extensions ?? [];
          const subProcess = cp.spawn(
            cliPath,
            [
              `--extensions-dir=${path.join(cachePath, "extensions")}`,
              `--user-data-dir=${path.join(cachePath, "user-data")}`,
              ...extensions.flatMap((extension) => ["--install-extension", extension]),
            ],
            {
              stdio: "inherit",
              shell: os.platform() === "win32",
            },
          );
          subProcess.on("exit", (code, signal) => {
            if (!code) resolve();
            else
              reject(new Error(`Failed to install extensions: code = ${code}, signal = ${signal}`));
          });
        });
      }

      await use({ installPath, cachePath });
    },
    { timeout: 0, scope: "worker" },
  ],

  // based on https://github.com/microsoft/playwright-vscode/blob/1d855b9a7aeca783223a7a9f8e3b01efbe8e16f2/tests-integration/tests/baseTest.ts
  electronApp: [
    async (
      { extensionDevelopmentPath, baseDir, _vscodeInstall, vscodeTrace, trace },
      use,
      testInfo,
    ) => {
      const { installPath, cachePath } = _vscodeInstall;

      // remove all VSCODE_* environment variables, otherwise it fails to load custom webviews with the following error:
      // InvalidStateError: Failed to register a ServiceWorker: The document is in an invalid state
      const env = { ...process.env } as Record<string, string>;
      for (const prop in env) {
        if (/^VSCODE_/i.test(prop)) delete env[prop];
      }

      const electronApp = await _electron.launch({
        executablePath: installPath,
        env,
        args: [
          // Stolen from https://github.com/microsoft/vscode-test/blob/0ec222ef170e102244569064a12898fb203e5bb7/lib/runTest.ts#L126-L160
          // https://github.com/microsoft/vscode/issues/84238
          "--no-sandbox",
          // https://github.com/microsoft/vscode-test/issues/221
          "--disable-gpu-sandbox",
          // https://github.com/microsoft/vscode-test/issues/120
          "--disable-updates",
          "--skip-welcome",
          "--skip-release-notes",
          "--disable-workspace-trust",
          `--extensions-dir=${path.join(cachePath, "extensions")}`,
          `--user-data-dir=${path.join(cachePath, "user-data")}`,
          `--extensionTestsPath=${path.join(__dirname, "injected", "index")}`,
          ...(extensionDevelopmentPath
            ? [`--extensionDevelopmentPath=${extensionDevelopmentPath}`]
            : []),
          baseDir,
        ],
      });

      const traceMode = getTraceMode(vscodeTrace);
      const captureTrace = shouldCaptureTrace(traceMode, testInfo);
      const context = electronApp.context();
      if (captureTrace) {
        const { screenshots, snapshots } =
          typeof vscodeTrace !== "string" ? vscodeTrace : { screenshots: true, snapshots: true };
        await context.tracing.start({ screenshots, snapshots, title: testInfo.title });
      }

      await use(electronApp);

      if (captureTrace) {
        const testFailed = testInfo.status !== testInfo.expectedStatus;
        const shouldAbandonTrace =
          !testFailed &&
          (traceMode === "retain-on-failure" || traceMode === "retain-on-first-failure");
        if (!shouldAbandonTrace) {
          // if default trace is not off, use vscode-trace to avoid conflicts
          const traceName = getTraceMode(trace) === "off" ? "trace" : "vscode-trace";
          const tracePath = testInfo.outputPath(`${traceName}.zip`);
          await context.tracing.stop({ path: tracePath });
          testInfo.attachments.push({
            name: traceName,
            path: tracePath,
            contentType: "application/zip",
          });
        }
      }

      await electronApp.close();

      const logPath = path.join(cachePath, "user-data", "logs");
      if (fs.existsSync(logPath)) {
        const logOutputPath = test.info().outputPath("vscode-logs");
        await fs.promises.cp(logPath, logOutputPath, { recursive: true });
      }
    },
    { timeout: 0 },
  ],

  workbox: async ({ electronApp }, use) => {
    await use(await electronApp.firstWindow());
  },

  page: ({ workbox }, use) => use(workbox),

  context: ({ electronApp }, use) => use(electronApp.context()),

  _evaluator: async ({ playwright, electronApp, workbox, vscodeTrace }, use, testInfo) => {
    const electronAppImpl = await (playwright as any)._toImpl(electronApp);
    const pageImpl = await (playwright as any)._toImpl(workbox);
    // check recent logs or wait for URL to access VSCode test server
    const vscodeTestServerRegExp = /^VSCodeTestServer listening on (http:\/\/.*)$/;
    const process = electronAppImpl._process as cp.ChildProcess;
    const recentLogs =
      electronAppImpl._nodeConnection._browserLogsCollector.recentLogs() as string[];
    let [match] = recentLogs.map((s) => s.match(vscodeTestServerRegExp)).filter(Boolean);
    if (!match) {
      match = await waitForLine(process, vscodeTestServerRegExp);
    }
    const ws = new WebSocket(match[1]);
    await new Promise((r) => ws.once("open", r));
    const traceMode = getTraceMode(vscodeTrace);
    const captureTrace = shouldCaptureTrace(traceMode, testInfo);
    const evaluator = new VSCodeEvaluator(ws, captureTrace ? pageImpl : undefined);
    await use(evaluator);
    ws.close();
  },

  _vscodeHandle: async ({ _evaluator }, use) => {
    await use(_evaluator.rootHandle());
  },

  evaluateInVSCode: async ({ _vscodeHandle }, use) => {
    // @ts-ignore
    await use((fn, arg) => _vscodeHandle.evaluate(fn, arg));
  },

  evaluateHandleInVSCode: async ({ _vscodeHandle }, use) => {
    const handles: ObjectHandle<unknown>[] = [];
    // @ts-ignore
    await use(async (fn, arg) => {
      const handle = await _vscodeHandle.evaluateHandle(fn, arg);
      handles.push(handle);
      return handle;
    });
    await Promise.all(handles.map((h) => h.release()));
  },

  _createTempDir: [
    async ({}, use) => {
      const tempDirs: string[] = [];
      await use(async () => {
        const tempDir = await fs.promises.realpath(
          await fs.promises.mkdtemp(path.join(os.tmpdir(), "pwtest-")),
        );
        await fs.promises.mkdir(tempDir, { recursive: true });
        tempDirs.push(tempDir);
        return tempDir;
      });
      for (const tempDir of tempDirs) await fs.promises.rm(tempDir, { recursive: true });
    },
    { scope: "worker" },
  ],

  _enableRecorder: [
    async ({ playwright, context }, use) => {
      const skip = !!process.env.CI;
      let closePromise: Promise<void> | undefined;
      if (!skip) {
        await (context as any)._enableRecorder({
          language: "playwright-test",
          mode: "recording",
        });
        const contextImpl = await (playwright as any)._toImpl(context);
        closePromise = new Promise((resolve) =>
          contextImpl.recorderAppForTest.once("close", resolve),
        );
      }
      await use();
      if (closePromise) await closePromise;
    },
    { timeout: 0 },
  ],
});
