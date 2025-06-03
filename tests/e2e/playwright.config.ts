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
const vscodeVersion = process.env.VSCODE_VERSION ?? "stable";

export default defineConfig<VSCodeTestOptions, VSCodeWorkerOptions>({
  testDir: path.join(__dirname, "specs"),
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  timeout: 120000,
  workers: 1,
  expect: {
    timeout: 10000,
  },
  reporter: "html",
  use: {
    // We run the tests against the bundled VSIX file.
    extensions: [vsix],
    // The test VS Code window instance is launched with the `out` directory
    // opened. This lets us load fixture files (the fixtures are copied over in the Gulp task `e2e`)
    // Make sure to run `gulp bundle` if you changed the extension `src` code.
    baseDir: path.join(__dirname, "..", "..", "out"),
    // Enables Playwright tracing to help with debugging. Super useful!
    vscodeTrace: "on",
  },
  projects: [
    {
      name: vscodeVersion,
      use: { vscodeVersion },
    },
  ],
});
