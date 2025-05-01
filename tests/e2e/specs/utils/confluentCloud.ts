import { ElectronApplication, chromium } from "@playwright/test";
import { stubMultipleDialogs } from "electron-playwright-helpers";
import { openConfluentExtension } from "./confluent";

/**
 * Sets up dialog stubs for the authentication flow
 * @param electronApp The Electron application instance
 */
async function stubAuthDialogs(electronApp: ElectronApplication): Promise<void> {
  await stubMultipleDialogs(electronApp, [
    // Asks whether to Allow signing in with Confluent Cloud
    {
      method: "showMessageBox",
      value: {
        response: 0, // Simulates clicking "Allow"
        checkboxChecked: false,
      },
    },
    // Asks for permission to open the URL
    {
      method: "showMessageBox",
      value: {
        response: 0, // Simulates clicking "Open"
        checkboxChecked: false,
      },
    },
  ]);
}

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
  let authUrl: string | null = null;

  await stubAuthDialogs(electronApp);

  // Intercept shell.openExternal calls
  // TODO: In a try/finally, de-intercept and put original impl back
  await electronApp.evaluate(({ shell }) => {
    const originalOpenExternal = shell.openExternal;
    shell.openExternal = (url: string) => {
      console.log("Intercepted URL:", url);
      if (url.includes("login.confluent.io")) {
        // Store the URL somewhere we can access it
        (global as any).__interceptedUrl = url;
        // Don't actually open the URL
        return Promise.resolve();
      }
      return originalOpenExternal(url);
    };
  });

  // Open the extension
  await openConfluentExtension(page);

  // Hover over "No Connection" to make sign-in button visible
  const ccloudConnection = await page.getByText("Confluent Cloud(No connection)");
  await ccloudConnection.click();

  // Click the Sign in to Confluent Cloud button
  const signInButton = await page.getByRole("button", { name: "Sign in to Confluent Cloud" });
  await signInButton.click();

  // Wait for dialogs to return
  await page.waitForTimeout(200);

  authUrl = await electronApp.evaluate(() => (global as any).__interceptedUrl);

  if (!authUrl) {
    throw new Error("Failed to capture OAuth URL from shell.openExternal");
  }

  // Handle the authentication flow
  await handleAuthFlow(authUrl, username, password, electronApp);

  // Wait for VS Code to process the authentication
  // It will open up a confirmation dialog, click "Open"
  const open = await page.getByRole("button", { name: "Open" });
  await open.waitFor({ state: "visible" });
  await open.click();

  // Expect a notification that says "Successfully signed in to Confluent Cloud as "
  await page
    .getByLabel(/Successfully signed in to Confluent Cloud as .*/)
    .locator("div")
    .filter({ hasText: "Successfully signed in to" })
    .nth(2)
    .waitFor({
      state: "visible",
      timeout: 200,
    });
}
