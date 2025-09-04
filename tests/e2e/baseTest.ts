import {
  _electron as electron,
  ElectronApplication,
  Page,
  test as testBase,
} from "@playwright/test";
import { downloadAndUnzipVSCode } from "@vscode/test-electron";
import { stubAllDialogs } from "electron-playwright-helpers";
import { mkdtempSync } from "fs";
import { unlink } from "fs/promises";
import { globSync } from "glob";
import { tmpdir } from "os";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface VSCodeFixture {
  page: Page;
  electronApp: ElectronApplication;
}

export const test = testBase.extend<VSCodeFixture>({
  electronApp: async ({ trace }, use, testInfo) => {
    // create a temporary directory for this test run
    const tempDir = mkdtempSync(path.join(tmpdir(), "vscode-test-"));

    const vscodeInstallPath: string = await downloadAndUnzipVSCode(
      process.env.VSCODE_VERSION || "stable",
    );
    console.log("VS Code install path:", vscodeInstallPath);

    const vscodeVersion = process.env.VSCODE_VERSION || "stable";

    // locate the VS Code executable path based on the platform
    let executablePath: string;
    if (["win32", "darwin"].includes(process.platform)) {
      executablePath = vscodeInstallPath;
    } else {
      // may be in the install path or in the root directory; need to see which one exists and
      // is executable
      const directExecutable = vscodeInstallPath;
      const insidersOrStable = vscodeVersion === "insiders" ? "code-insiders" : "code";
      const rootExecutable = path.join(vscodeInstallPath, insidersOrStable);
      executablePath = directExecutable.endsWith(insidersOrStable)
        ? directExecutable
        : rootExecutable;
    }
    console.log(`${process.platform} VS Code executable path:`, executablePath);

    const extensionPath: string = path.normalize(path.resolve(__dirname, "..", ".."));
    const outPath: string = path.normalize(path.resolve(extensionPath, "out"));
    const vsixFiles: string[] = globSync("*.vsix", { cwd: outPath });
    const vsixPath = vsixFiles.length > 0 ? path.join(outPath, vsixFiles[0]) : undefined;
    if (!vsixPath) {
      // shouldn't happen during normal `gulp e2e`
      throw new Error("No VSIX file found in the out/ directory. Run 'npx gulp bundle' first.");
    }

    console.log(`Launching VS Code (${vscodeVersion}) with:`);
    console.log("  Executable:", executablePath);
    console.log("  Extension path:", extensionPath);
    console.log("  VSIX path:", vsixPath);
    console.log("  Temp dir:", tempDir);

    // launch VS Code with Electron using args pattern from vscode-test
    const electronApp = await electron.launch({
      executablePath,
      args: [
        // same as the Mocha test args in Gulpfile.js:
        "--no-sandbox",
        "--skip-release-notes",
        "--skip-welcome",
        "--disable-gpu",
        "--disable-updates",
        "--disable-workspace-trust",
        "--disable-extensions",
        // required to prevent test resources being saved to user's real profile
        `--user-data-dir=${tempDir}`,
        // additional args needed for the Electron launch:
        `--extensionDevelopmentPath=${outPath}`,
      ],
    });

    if (!electronApp) {
      throw new Error("Failed to launch VS Code electron app");
    }

    // wait for VS Code to be ready before trying to stub dialogs
    const page = await electronApp.firstWindow();
    if (!page) {
      // usually this means the launch args were incorrect and/or the app didn't start correctly
      throw new Error("Failed to get first window from VS Code");
    }
    await page.waitForLoadState("domcontentloaded");
    await page.locator(".monaco-workbench").waitFor({ timeout: 30000 });

    // Stub all dialogs by default; tests can still override as needed.
    // For available `method` values to use with `stubMultipleDialogs`, see:
    // https://www.electronjs.org/docs/latest/api/dialog
    await stubAllDialogs(electronApp);

    // on*, retain-on*
    if (trace.toString().includes("on")) {
      console.log("Starting trace capture for test:", testInfo.title);
      await electronApp.context().tracing.start({
        screenshots: true,
        snapshots: true,
        sources: true,
        title: testInfo.title,
      });
    }

    await use(electronApp);

    try {
      // shorten grace period for shutdown to avoid hanging the entire test run
      await Promise.race([
        electronApp.close(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("electronApp.close() timeout after 10s")), 10000),
        ),
      ]);
    } catch (error) {
      console.warn("Error closing electron app:", error);
      // force-kill if needed
      try {
        await electronApp.context().close();
      } catch (contextError) {
        console.warn("Error closing electron context:", contextError);
      }
    }
  },

  page: async ({ electronApp }, use) => {
    if (!electronApp) {
      throw new Error("electronApp is null - failed to launch VS Code");
    }

    const page = await electronApp.firstWindow();
    if (!page) {
      // shouldn't happen since we waited for the workbench above
      throw new Error("Failed to get first window from VS Code");
    }

    await use(page);
  },
});

export const CCLOUD_SIGNIN_URL_PATH = path.join(tmpdir(), "vscode-e2e-ccloud-signin-url.txt");

/** E2E global beforeAll hook */
test.beforeAll(async () => {});

/** E2E global beforeEach hook */
test.beforeEach(async () => {
  // reset the CCloud sign-in file before each test so we don't accidentally get a stale URL
  try {
    await unlink(CCLOUD_SIGNIN_URL_PATH);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn("Error deleting CCloud sign-in URL file:", error);
    }
  }
});

/** E2E global afterEach hook */
test.afterEach(async () => {});

/** E2E global afterAll hook */
test.afterAll(async () => {});
