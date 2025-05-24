import { defineConfig } from "@playwright/test";
import { configDotenv } from "dotenv";
import { globSync } from "glob";
import path from "path";
import { fileURLToPath } from "url";
import { VSCodeTestOptions, VSCodeWorkerOptions } from "vscode-test-playwright";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

configDotenv({
  path: path.join(__dirname, "..", "..", ".env"),
});

const vsix: string = globSync(path.resolve(__dirname, "..", "..", "out", "*.vsix")).at(0) as string;
const isInsiders = process.env.TERM_PROGRAM_VERSION?.endsWith("insider");
const vscodeVersion = process.env.VSCODE_VERSION || (isInsiders ? "insiders" : "stable");

export default defineConfig<VSCodeTestOptions, VSCodeWorkerOptions>({
  testDir: path.join(__dirname, "specs"),
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  maxFailures: process.env.CI ? 1 : 0,
  timeout: 120000,
  workers: 1,
  expect: {
    timeout: 10000,
  },
  reporter: "html",
  use: {
    extensions: [vsix],
    baseDir: path.join(__dirname, "..", "..", "out"),
    vscodeTrace: "on",
  },
  projects: [
    {
      name: vscodeVersion,
      use: { vscodeVersion },
    },
  ],
});
