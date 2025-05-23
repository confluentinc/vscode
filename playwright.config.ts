import { defineConfig } from "@playwright/test";
import { configDotenv } from "dotenv";

configDotenv();

export default defineConfig({
  use: {
    headless: true,
    viewport: { width: 1920, height: 1080 },
  },
  workers: 1,
  testMatch: "src/**/*.spec.ts",
  reporter: [
    ["list"],
    ["rollwright/coverage-reporter", { name: "text" }],
    [
      "rollwright/coverage-reporter",
      { name: "lcovonly", options: { file: "lcov-functional.info" } },
    ],
  ],
});
