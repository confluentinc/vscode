import { test as setup } from "@playwright/test";
import { downloadAndUnzipVSCode } from "@vscode/test-electron";
import { writeFileSync } from "fs";
import { globSync } from "glob";
import { tmpdir } from "os";
import path from "path";
import { fileURLToPath } from "url";

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
  console.log(`Setting up VS Code (${vscodeVersion}) for E2E tests...`);

  const vscodeInstallPath = await downloadAndUnzipVSCode(vscodeVersion);
  console.log(`VS Code (${vscodeVersion}) install path: ${vscodeInstallPath}`);

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
  console.log(
    `${process.platform} VS Code (${vscodeVersion}) executable path:`,
    vscodeExecutablePath,
  );

  const extensionPath = path.normalize(path.resolve(__dirname, "..", ".."));
  const outPath: string = path.normalize(path.resolve(extensionPath, "out"));
  const vsixFiles: string[] = globSync("*.vsix", { cwd: outPath });
  const vsixPath = vsixFiles.length > 0 ? path.join(outPath, vsixFiles[0]) : "";
  if (!vsixPath) {
    // shouldn't happen during normal `gulp e2e`
    throw new Error("No VSIX file found in the out/ directory. Run 'npx gulp bundle' first.");
  }

  console.log("Test setup complete, using:");
  console.log("  Executable:", vscodeExecutablePath);
  console.log("  Extension out/ path:", outPath);

  // save test setup cache to file for other workers to read
  const testSetupCache: TestSetupCache = {
    vscodeExecutablePath: vscodeExecutablePath,
    outPath,
  };
  writeFileSync(TEST_SETUP_CACHE_FILE, JSON.stringify(testSetupCache, null, 2));
  console.log("test setup cache saved to:", TEST_SETUP_CACHE_FILE);
});
