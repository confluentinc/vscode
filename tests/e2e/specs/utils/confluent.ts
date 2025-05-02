import { Page } from "@playwright/test";

/**
 * Clicks on the Confluent extension to load it. This is meant to be called
 * before any subsequent action is taken place.
 * @param page
 */
export async function openConfluentExtension(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded");

  const confluentTab = await page.getByRole("tab", { name: "Confluent" }).locator("a");
  await confluentTab.click();

  // The "Confluent Cloud" text will be present whether logged in or not
  // so this function is safe to use regardless.
  await page.getByText("Confluent Cloud").waitFor({
    state: "visible",
    timeout: 10_000,
  });
}
