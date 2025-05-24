import { Page } from "@playwright/test";

/**
 * Clicks on the Confluent extension to load it. This is meant to be called
 * before any subsequent action is taken place.
 * @param page
 */
export async function openConfluentExtension(page: Page): Promise<void> {
  try {
    // First ensure the page exists and is ready
    await page.waitForFunction(() => document.readyState === "complete", { timeout: 30000 });
    await page.waitForLoadState("domcontentloaded", { timeout: 30000 });

    // Wait for the Confluent tab to be visible first
    const confluentTab = await page.getByRole("tab", { name: "Confluent" }).locator("a").first();
    await confluentTab.waitFor({ state: "visible", timeout: 30000 });
    await confluentTab.click();

    // The "Confluent Cloud" text will be present whether logged in or not
    // so this function is safe to use regardless.
    const cloudText = page.getByText("Confluent Cloud");
    await cloudText
      .waitFor({
        state: "visible",
        timeout: 30_000,
      })
      .catch((error) => {
        throw new Error(
          `Failed to find "Confluent Cloud" text after clicking tab: ${error.message}`,
        );
      });

    // Close any notifications that pop up on load. These make it impossible to
    // interact with UI elements hidden behind them.
    const clearableNotifications = await page.getByLabel(/Clear Notification/).all();
    for (const notification of clearableNotifications) {
      await notification.click();
    }
  } catch (error) {
    console.error("Failed to open Confluent extension:", error);
    // Re-throw the error to fail the test
    throw error;
  }
}
