import {
  _electron as electron,
  ElectronApplication,
  Page,
  test as testBase,
} from "@playwright/test";
import { downloadAndUnzipVSCode } from "@vscode/test-electron";
import { mkdtempSync } from "fs";
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
    if (process.platform === "darwin") {
      // on macOS, the install path is already the full path to the executable
      executablePath = vscodeInstallPath;
    } else if (process.platform === "win32") {
      executablePath = path.join(
        vscodeInstallPath,
        vscodeVersion === "insiders" ? "Code - Insiders.exe" : "Code.exe",
      );
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

    const extensionPath: string = path.resolve(__dirname, "..", "..");
    const outPath: string = path.resolve(extensionPath, "out");
    const vsixFiles: string[] = globSync(path.resolve(outPath, "*.vsix"));
    const vsixPath = vsixFiles[0];
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
        "--profile-temp",
        "--skip-release-notes",
        "--skip-welcome",
        "--disable-gpu",
        "--disable-updates",
        "--disable-workspace-trust",
        "--disable-extensions",
        // additional args needed for the Electron launch:
        `--user-data-dir=${tempDir}`,
        `--extensionDevelopmentPath=${outPath}`,
        "--new-window",
      ],
    });

    if (!electronApp) {
      throw new Error("Failed to launch VS Code electron app");
    }

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
      await electronApp.close();
    } catch (error) {
      console.warn("Error closing electron app:", error);
    }
  },

  page: async ({ electronApp }, use) => {
    if (!electronApp) {
      throw new Error("electronApp is null - failed to launch VS Code");
    }

    const page = await electronApp.firstWindow();
    if (!page) {
      // usually this means the launch args were incorrect and/or the app didn't start correctly
      throw new Error("Failed to get first window from VS Code");
    }

    // wait for VS Code to be ready
    await page.waitForLoadState("domcontentloaded");
    await page.waitForSelector(".monaco-workbench", { timeout: 30000 });
    await use(page);
  },
});
