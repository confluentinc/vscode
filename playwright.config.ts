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
  use: {
    // set different baseURL for Windows
    baseURL: process.platform === "win32" ? "http://localhost:3000" : undefined,
  },
});
