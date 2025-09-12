import { ElectronApplication, chromium, expect } from "@playwright/test";
import { stubMultipleDialogs } from "electron-playwright-helpers";
import { readFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { Notification } from "../../objects/notifications/Notification";
import { NotificationArea } from "../../objects/notifications/NotificationArea";
import { ResourcesView } from "../../objects/views/ResourcesView";
import { ViewItem } from "../../objects/views/viewItems/ViewItem";

export const CCLOUD_SIGNIN_URL_PATH = join(tmpdir(), "vscode-e2e-ccloud-signin-url.txt");
const NOT_CONNECTED_TEXT = "(No connection)";

/**
 * Handles the Confluent Cloud authentication flow in a separate browser
 * @param authUrl The OAuth URL to authenticate with
 * @param username The username to authenticate with
 * @param password The password to authenticate with
 */
async function handleAuthFlow(authUrl: string, username: string, password: string): Promise<void> {
  const browser = await chromium.launch(); // headless by default
  const context = await browser.newContext();
  const authPage = await context.newPage();

  try {
    // Navigate to the auth URL and wait for the page to be fully loaded
    await authPage.goto(authUrl, { waitUntil: "domcontentloaded", timeout: 3000 });

    // Additional wait to ensure page is interactive
    await authPage.waitForLoadState("domcontentloaded");

    // Wait for email input to be visible and ready
    await expect(authPage.locator("[name=email]")).toBeVisible();

    // Fill in credentials
    await authPage.locator("[name=email]").fill(username);
    await authPage.locator("[type=submit]").click();
    await authPage.locator("[name=password]").fill(password);
    await authPage.locator("[type=submit]").click();

    await expect(authPage.locator("text=Authentication Complete")).toBeVisible();
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
  // reset the CCloud sign-in file before the sign-in flow even starts so we don't use a stale URL
  try {
    await unlink(CCLOUD_SIGNIN_URL_PATH);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn("Error deleting CCloud sign-in URL file:", error);
    }
  }

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
  let authUrl: string | null = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      authUrl = await readFile(CCLOUD_SIGNIN_URL_PATH, "utf-8");
      if (authUrl.trim()) {
        break;
      }
    } catch {
      // file doesn't exist yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!authUrl) {
    throw new Error(`Failed to load CCloud sign-in URL from ${CCLOUD_SIGNIN_URL_PATH}`);
  }

  // Handle the authentication flow through the browser in a separate context
  await handleAuthFlow(authUrl, username, password);

  // Unfortunately, the auth callback URI handling does not reliably work on all environments
  // we run these tests, so we have to work around it:
  // - when the E2E tests start via `gulp e2e`, we set the CONFLUENT_VSCODE_E2E_TESTING environment
  //  variable, which sets the CCLOUD_AUTH_CALLBACK_URI to an empty string, preventing the sidecar
  //  from using it (see https://github.com/confluentinc/ide-sidecar/blob/f302286ff0f7234581b07cef4ec978e33030617f/src/main/resources/templates/callback.html#L13-L16)
  // - since the extension's UriHandler is never triggered, we have to explicitly cancel the
  //  "Signing in ..." progress notification and click the sign-in action again to refresh the
  //  connection state and show the available environments
  // NOTE: This is safe because handleAuthFlow() didn't throw any errors by this point, which means
  // we saw an "Authentication Complete" message in the browser, so the sidecar should have done its
  // own callback handling to update the CCloud connection to a fully authenticated state.
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
