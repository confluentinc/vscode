import { defineConfig } from "@playwright/test";
import { configDotenv } from "dotenv";

configDotenv();

export default defineConfig({
  testMatch: "*.spec.ts",
  reporter: [
    ["list"],
    ["rollwright/coverage-reporter", { name: "text" }],
    [
      "rollwright/coverage-reporter",
      { name: "lcovonly", options: { file: "lcov-functional.info" } },
    ],
  ],
});
