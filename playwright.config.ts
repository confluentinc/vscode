import { defineConfig } from "@playwright/test";
import { configDotenv } from "dotenv";

configDotenv();

export default defineConfig({
  use: {
    headless: true,
    viewport: { width: 1920, height: 1080 },
  },
  timeout: 120000,
  workers: 1,
  expect: {
    timeout: 10000,
  },
  globalSetup: "./tests/e2e/setup.ts",
  testMatch: "**/*.spec.ts",
  reporter: [
    ["list"],
    ["rollwright/coverage-reporter", { name: "text" }],
    [
      "rollwright/coverage-reporter",
      { name: "lcovonly", options: { file: "lcov-functional.info" } },
    ],
  ],
});
