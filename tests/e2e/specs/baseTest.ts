import type { Page } from "@playwright/test";
import { _electron, test as base, ElectronApplication } from "@playwright/test";
import { downloadAndUnzipVSCode } from "@vscode/test-electron";
import { configDotenv } from "dotenv";
import fs from "fs";
import os from "os";
import path, { dirname } from "path";
import { fileURLToPath } from "url";

configDotenv();

export { expect } from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export type TestOptions = {
  vscodeVersion: string;
};

type TestFixtures = TestOptions & {
  page: Page;
  electronApp: ElectronApplication;
  createTmpDir: () => Promise<string>;
};

export const MaxTimeout = 10000;

let testProjectPath: string;
export const test = base.extend<TestFixtures>({
  vscodeVersion: ["insiders", { option: true }],
  electronApp: async ({ vscodeVersion, createTmpDir }, use) => {
    const defaultCachePath = await createTmpDir();
    const vscodePath = await downloadAndUnzipVSCode(vscodeVersion);
    testProjectPath = path.resolve(__dirname, "..", "..", "..", "out");

    const userDataDir = path.join(defaultCachePath, "user-data");
    const logsPath = path.join(defaultCachePath, "logs");

    // Launch VS Code
    const electronApp = await _electron.launch({
      executablePath: vscodePath,
      args: [
        "--no-sandbox",
        "--disable-gpu-sandbox",
        "--disable-updates",
        "--skip-welcome",
        "--skip-release-notes",
        "--disable-workspace-trust",
        "--enable-proposed-api",
        "--disable-telemetry",
        "--disable-extensions",
        `--extensionDevelopmentPath=${testProjectPath}`,
        `--user-data-dir=${userDataDir}`,
        `--logsPath=${logsPath}`,
        testProjectPath
      ],
      env: Object.fromEntries(
        Object.entries(process.env)
          .filter(([_, value]) => value !== undefined)
          .map(([key, value]) => [key, value as string])
      )
    });

    console.log("Launched VS Code with PID:", electronApp.process().pid);
    await use(electronApp);
    await electronApp.close();
  },
  page: async ({ electronApp }, use) => {
    try {
      // Get the first window
      const page = await electronApp.firstWindow();

      // Set up error handling
      page.on("pageerror", (error) => console.error(`Playwright ERROR: page error: ${error}`));
      page.on("crash", () => console.error("Playwright ERROR: page crash"));
      page.on("response", (response) => {
        if (response.status() >= 400) {
          console.error(`Playwright ERROR: HTTP status ${response.status()} for ${response.url()}`);
        }
      });

      await use(page);
    } catch (error) {
      console.error(error);
    }
  },
  createTmpDir: async ({}, use) => {
    const tempDirs: string[] = [];
    await use(async () => {
      const tempDir = await fs.promises.realpath(
        await fs.promises.mkdtemp(path.join(os.tmpdir(), "gltest-")),
      );
      tempDirs.push(tempDir);
      return tempDir;
    });
    for (const tempDir of tempDirs) {
      await fs.promises.rm(tempDir, { recursive: true });
    }
  },
});
