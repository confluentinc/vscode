import {
  _electron as electron,
  ElectronApplication,
  expect,
  Page,
  test as testBase,
} from "@playwright/test";
import { stubAllDialogs } from "electron-playwright-helpers";
import { existsSync, mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { Notification } from "./objects/notifications/Notification";
import { NotificationArea } from "./objects/notifications/NotificationArea";

// NOTE: we can't import these two directly from 'global.setup.ts'
// cached test setup file path that's shared across worker processes
const TEST_SETUP_CACHE_FILE = path.join(tmpdir(), "vscode-e2e-test-setup-cache.json");

interface TestSetupCache {
  vscodeExecutablePath: string;
  outPath: string;
}

/** Get the test setup cache created by the global setup, avoiding repeated VS Code setup logging. */
function getTestSetupCache(): TestSetupCache {
  if (!existsSync(TEST_SETUP_CACHE_FILE)) {
    throw new Error(`Test setup cache file not found at ${TEST_SETUP_CACHE_FILE}.`);
  }
  try {
    const cacheContent = readFileSync(TEST_SETUP_CACHE_FILE, "utf-8");
    return JSON.parse(cacheContent);
  } catch (error) {
    throw new Error(`Failed to read test setup cache: ${error}`);
  }
}

export interface VSCodeFixture {
  page: Page;
  electronApp: ElectronApplication;
}

export const test = testBase.extend<VSCodeFixture>({
  electronApp: async ({ trace }, use, testInfo) => {
    const testConfigs = getTestSetupCache();

    // create a temporary directory for this test run
    const tempDir = mkdtempSync(path.join(tmpdir(), "vscode-test-"));

    // launch VS Code with Electron using args pattern from vscode-test
    const electronApp = await electron.launch({
      executablePath: testConfigs.vscodeExecutablePath,
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
        `--extensionDevelopmentPath=${testConfigs.outPath}`,
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

    // dismiss the "All installed extensions are temporarily disabled" notification that will
    // always appear since we launch with --disable-extensions
    const notificationArea = new NotificationArea(page);
    const infoNotifications = notificationArea.infoNotifications.filter({
      hasText: "All installed extensions are temporarily disabled",
    });
    await expect(infoNotifications).not.toHaveCount(0);
    const notification = new Notification(page, infoNotifications.first());
    await notification.dismiss();

    await use(page);
  },
});
