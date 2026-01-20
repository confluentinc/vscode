import { test as setup } from "@playwright/test";
import { downloadAndUnzipVSCode } from "@vscode/test-electron";
import { writeFileSync } from "fs";
import { globSync } from "glob";
import { tmpdir } from "os";
import path from "path";
import { fileURLToPath } from "url";
import { DEBUG_LOGGING_ENABLED } from "./constants";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// cached test setup file path that's shared across worker processes
const TEST_SETUP_CACHE_FILE = path.join(tmpdir(), "vscode-e2e-test-setup-cache.json");

interface TestSetupCache {
  vscodeExecutablePath: string;
  outPath: string;
}

setup("setup VS Code for E2E tests", async () => {
  const vscodeVersion = process.env.VSCODE_VERSION || "stable";
  const vscodeInstallPath = await downloadAndUnzipVSCode(vscodeVersion);

  // locate the VS Code executable path based on the platform
  let vscodeExecutablePath: string;
  if (["win32", "darwin"].includes(process.platform)) {
    vscodeExecutablePath = vscodeInstallPath;
  } else {
    // may be in the install path or in the root directory; need to see which one exists and
    // is executable
    const directExecutable = vscodeInstallPath;
    const insidersOrStable = vscodeVersion === "insiders" ? "code-insiders" : "code";
    const rootExecutable = path.join(vscodeInstallPath, insidersOrStable);
    vscodeExecutablePath = directExecutable.endsWith(insidersOrStable)
      ? directExecutable
      : rootExecutable;
  }
  if (DEBUG_LOGGING_ENABLED) {
    console.debug(`Setting up VS Code (${vscodeVersion}) for E2E tests`, {
      vscodeInstallPath,
      vscodeExecutablePath,
      platform: process.platform,
    });
  }

  const extensionPath = path.normalize(path.resolve(__dirname, "..", ".."));
  const outPath: string = path.normalize(path.resolve(extensionPath, "out"));
  const vsixFiles: string[] = globSync("*.vsix", { cwd: outPath });
  const vsixPath = vsixFiles.length > 0 ? path.join(outPath, vsixFiles[0]) : "";
  if (!vsixPath) {
    // shouldn't happen during normal `gulp e2e`
    throw new Error("No VSIX file found in the out/ directory. Run 'npx gulp bundle' first.");
  }

  // save test setup cache to file for other workers to read
  const testSetupCache: TestSetupCache = {
    vscodeExecutablePath: vscodeExecutablePath,
    outPath,
  };
  writeFileSync(TEST_SETUP_CACHE_FILE, JSON.stringify(testSetupCache, null, 2));

  if (DEBUG_LOGGING_ENABLED) {
    console.debug("Test setup complete", {
      vscodeVersion,
      extensionPath,
      vsixPath,
      vscodeExecutablePath,
      outPath,
      testSetupCacheFile: TEST_SETUP_CACHE_FILE,
    });
  }
});
