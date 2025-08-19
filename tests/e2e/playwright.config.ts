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

export default defineConfig({
  testDir: path.normalize(path.join(__dirname, "specs")),
  forbidOnly: !!process.env.CI,
  retries: 0,
  maxFailures: 1,
  timeout: 120000,
  workers: 1,
  expect: {
    timeout: process.env.CI ? 30_000 : 10000,
  },
  reporter: process.env.CI
    ? [
        ["html"],
        [
          "junit",
          {
            outputFile: path.normalize(path.join(__dirname, "..", "..", "TEST-result-e2e.xml")),
            includeProjectInTestName: true,
            suiteName: `VS Code (${vscodeVersion}) Extension Tests: E2E (${process.platform} ${process.arch})`,
          },
        ],
      ]
    : "html",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: vscodeVersion,
    },
  ],
});
