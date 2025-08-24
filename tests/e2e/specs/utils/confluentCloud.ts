import { ElectronApplication, chromium, expect } from "@playwright/test";
import { stubMultipleDialogs } from "electron-playwright-helpers";
import { readFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { NotificationArea } from "../../objects/notifications/NotificationArea";

/**
 * Handles the Confluent Cloud authentication flow in a separate browser
 * @param authUrl The OAuth URL to authenticate with
 * @param username The username to authenticate with
 * @param password The password to authenticate with
 * @param electronApp The Electron application instance
 */
async function handleAuthFlow(
  authUrl: string,
  username: string,
  password: string,
  electronApp: ElectronApplication,
): Promise<void> {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const authPage = await context.newPage();

  try {
    // Navigate to the auth URL and wait for the page to be fully loaded
    await authPage.goto(authUrl, { waitUntil: "domcontentloaded", timeout: 3000 });

    // Additional wait to ensure page is interactive
    await authPage.waitForLoadState("domcontentloaded");

    // Wait for email input to be visible and ready
    await authPage.waitForSelector("[name=email]", { state: "visible", timeout: 6000 });

    // Fill in credentials
    await authPage.locator("[name=email]").fill(username);
    await authPage.locator("[type=submit]").click();
    await authPage.locator("[name=password]").fill(password);
    await authPage.locator("[type=submit]").click();

    // Wait for success page
    try {
      await authPage.waitForSelector("text=Authentication Complete", { timeout: 3000 });
    } catch (error) {
      throw new Error("Authentication failed.");
    }

    // If we reach here, that means auth has succeeded
    // Trigger the callback URL in VS Code
    await electronApp.evaluate(({ shell }) => {
      shell.openExternal("vscode://confluentinc.vscode-confluent/authCallback?success=true");
    });

    // Close browser resources before returning
    await authPage.close();
    await context.close();
    await browser.close();
  } catch (error) {
    // Ensure browser resources are closed even if there's an error
    await authPage.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    throw error;
  }
}

/**
 * Performs the complete Confluent Cloud login flow
 * @param page The Playwright page instance
 * @param electronApp The Electron application instance
 * @param username The username to authenticate with
 * @param password The password to authenticate with
 */
export async function login(
  page: any,
  electronApp: ElectronApplication,
  username: string,
  password: string,
): Promise<void> {
  const confirmButtonIndex = process.platform === "linux" ? 1 : 0;
  await stubMultipleDialogs(electronApp, [
    // Handles both auth dialogs:
    // 1. "Allow signing in with Confluent Cloud"
    // 2. "Permission to open the URL"
    {
      method: "showMessageBox",
      value: {
        response: confirmButtonIndex, // Simulates clicking "Allow"/"Open"
        checkboxChecked: false,
      },
    },
  ]);

  // Hover over "No Connection" to make sign-in button visible
  const ccloudConnection = await page.getByText("Confluent Cloud(No connection)");
  await ccloudConnection.click();

  // Click the Sign in to Confluent Cloud button
  const signInButton = await page.getByRole("button", { name: "Sign in to Confluent Cloud" });
  await signInButton.click();

  // Wait for dialogs to return
  await page.waitForTimeout(200);

  // the auth provider will write to this once it gets the CCloud sign-in URL from the sidecar
  const tempFilePath = join(tmpdir(), "vscode-e2e-ccloud-signin-url.txt");
  let authUrl: string | null = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      authUrl = await readFile(tempFilePath, "utf-8");
      if (authUrl.trim()) {
        break;
      }
    } catch {
      // file doesn't exist yet
    }
    await page.waitForTimeout(250);
  }
  if (!authUrl) {
    throw new Error("Failed to capture OAuth URL from shell.openExternal");
  }

  // Handle the authentication flow
  await handleAuthFlow(authUrl, username, password, electronApp);

  // delete the temp file with the sign-in URL
  try {
    await unlink(tempFilePath);
  } catch (error) {
    console.warn("Failed to clean up temp file:", error);
  }

  // Wait for VS Code to process the authentication
  // It will open up a confirmation dialog, click "Open"
  // NOTE: this is not a system/Electron dialog like the one stubbed earlier
  const open = await page.getByRole("button", { name: "Open" });
  await open.waitFor({ state: "visible" });
  await open.click();

  // Expect a notification that says "Successfully signed in to Confluent Cloud as "
  const notificationArea = new NotificationArea(page);
  const signInNotification = notificationArea.infoNotifications.filter({
    hasText: /Successfully signed in to Confluent Cloud/,
  });
  await expect(signInNotification.first()).toBeVisible();
}
