import { ElectronApplication, chromium, expect } from "@playwright/test";
import { stubMultipleDialogs } from "electron-playwright-helpers";
import { readFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { Notification } from "../../objects/notifications/Notification";
import { NotificationArea } from "../../objects/notifications/NotificationArea";
import { ResourcesView } from "../../objects/views/ResourcesView";
import { ViewItem } from "../../objects/views/viewItems/ViewItem";

const NOT_CONNECTED_TEXT = "(No connection)";

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
      await authPage.waitForSelector("text=Authentication Complete");
    } catch (error) {
      throw new Error("Authentication failed.");
    }
  } finally {
    // Ensure browser resources are closed even if there's an error
    await authPage.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
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

  const resourcesView = new ResourcesView(page);
  const ccloudItem = new ViewItem(page, resourcesView.confluentCloudItem);
  await expect(ccloudItem.locator).toContainText(NOT_CONNECTED_TEXT);
  await ccloudItem.clickInlineAction("Sign in to Confluent Cloud");

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

  // Handle the authentication flow through the browser in a separate context
  await handleAuthFlow(authUrl, username, password, electronApp);

  // delete the temp file with the sign-in URL
  try {
    await unlink(tempFilePath);
  } catch (error) {
    console.warn("Failed to clean up temp file:", error);
  }

  // Unfortunately, the auth callback URI handling does not reliably work on all environments
  // we run these tests, so we have to work around it by cancelling the progress notification
  // and clicking the sign-in action again. This is safe since handleAuthFlow completed successfully,
  // which would normally trigger the URI handling and resolve the progress notification and refresh
  // the Resources view / Confluent Cloud connection item.
  const notifications = new NotificationArea(page);
  const progressNotifications = notifications.progressNotifications.filter({
    hasText: "Signing in to Confluent Cloud...",
  });
  await expect(progressNotifications).toHaveCount(1);
  const signInNotification = new Notification(page, progressNotifications.first());
  await signInNotification.clickActionButton("Cancel");

  // Click the "Sign in to Confluent Cloud" action from the Resources view to refresh the connection
  // state and show available environments
  await ccloudItem.clickInlineAction("Sign in to Confluent Cloud");
  // Make sure the "Confluent Cloud" item in the Resources view is expanded and doesn't show the
  // "(No connection)" description
  await expect(ccloudItem.locator).toBeVisible();
  await expect(ccloudItem.locator).not.toContainText(NOT_CONNECTED_TEXT);
  await expect(ccloudItem.locator).toHaveAttribute("aria-expanded", "true");
}
