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
const WINDOWS_FACTOR = process.platform === "win32" ? 2 : 1;

export default defineConfig({
  testDir: path.normalize(path.join(__dirname, "specs")),
  forbidOnly: !!process.env.CI,
  retries: 2,
  timeout: 120000,
  workers: 1,
  expect: {
    // Windows may take 10sec+ just to start activating the extension, so it needs some extra time
    // even when running tests locally
    timeout: WINDOWS_FACTOR * (process.env.CI ? 60_000 : 30_000),
  },
  reporter: process.env.CI
    ? [
        ["list"],
        // Generate blob reports for each job so they can be merged into a single HTML report for
        // each job in the pipeline (see mk-files/semaphore.mk).
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
    trace: "retain-on-failure",
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
