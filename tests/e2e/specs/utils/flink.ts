import { Page } from "@playwright/test";

export async function enableFlink(page: Page) {
  // Open settings
  await (await page.getByRole("treeitem", { name: "Open Settings" })).click();
  // Go to JSON file
  await (await page.getByLabel("Open Settings (JSON)")).click();
  // Click the tab again to make sure we're focused
  await (await page.getByRole("tab", { name: "settings.json" })).click();

  await page.keyboard.press("ControlOrMeta+A");

  // HACK
  await page.keyboard.type(`{"confluent.preview.enableFlink`);
  // Sleep
  await page.waitForTimeout(50);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(50);
  await page.keyboard.type("true");

  // Save the file
  await page.keyboard.press("ControlOrMeta+S");

  // Close the settings file
  await (await page.getByRole("tab", { name: "settings.json" }).getByLabel("Close")).click();
}
