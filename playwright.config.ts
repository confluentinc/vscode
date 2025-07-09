import { defineConfig } from "@playwright/test";
import { configDotenv } from "dotenv";

configDotenv();

const reporters: any[] = [
  ["list"],
  ["rollwright/coverage-reporter", { name: "text" }],
  ["rollwright/coverage-reporter", { name: "lcovonly", options: { file: "lcov-functional.info" } }],
];

if (process.env.CI) {
  const vscodeVersion = process.env.VSCODE_VERSION ?? "stable";
  reporters.push([
    "junit",
    {
      outputFile: "TEST-result-webview.xml",
      includeProjectInTestName: true,
      suiteName: `VS Code (${vscodeVersion}) Extension Tests: Webview (${process.platform} ${process.arch})`,
    },
  ]);
}

export default defineConfig({
  use: {
    headless: true,
    viewport: { width: 1920, height: 1080 },
  },
  workers: 1,
  testMatch: "src/**/*.spec.ts",
  reporter: reporters,
});
