import { defineConfig } from "@playwright/test";
import { configDotenv } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

configDotenv({
  path: path.join(__dirname, "..", "..", ".env"),
});

const vscodeVersion = process.env.VSCODE_VERSION || "stable";

/** Multiplier to use for timeouts when running tests in CI environments */
const CI_FACTOR = process.env.CI ? 2 : 1;
/** Multiplier to use for timeouts when running tests in Windows environments */
const WINDOWS_FACTOR = process.platform === "win32" ? 2 : 1;

export default defineConfig({
  testDir: path.normalize(path.join(__dirname, "specs")),
  forbidOnly: !!process.env.CI,
  maxFailures: 1, // uncomment for local dev/debugging purposes
  retries: 2,
  timeout: 120_000 * CI_FACTOR * WINDOWS_FACTOR, // 2min to 8min on CI Windows
  expect: {
    timeout: 30_000 * CI_FACTOR * WINDOWS_FACTOR, // 30s to 2min on CI Windows
  },
  // due to the sidecar handshaking and single port usage, we cannot use more than one worker or
  // tests will stall by fighting for control of the sidecar access token
  workers: 1,
  reporter: process.env.CI
    ? [
        ["list"],
        // Generate blob reports for each test so they can be merged into a single per-job HTML
        // report, including traces (see mk-files/semaphore.mk).
        // (see https://playwright.dev/docs/test-reporters#blob-reporter)
        ["blob"],
        [
          "junit",
          {
            outputFile: path.normalize(path.join(__dirname, "..", "..", "TEST-result-e2e.xml")),
            includeProjectInTestName: true,
            suiteName: `VS Code (${vscodeVersion}) Extension Tests: E2E (${process.platform} ${process.arch})`,
          },
        ],
      ]
    : [["list"], ["html"]],
  use: {
    trace: "off", // manually configured in baseTest.ts
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "setup",
      testMatch: "**/global.setup.ts",
      testDir: path.join(__dirname),
    },
    {
      name: `vscode-${vscodeVersion}`,
      dependencies: ["setup"],
    },
  ],
});
