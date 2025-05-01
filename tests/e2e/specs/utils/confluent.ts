import { Page } from "@playwright/test";

export async function openConfluentView(page: Page): Promise<void> {
  const confluentTab = page.getByRole('tab', { name: 'Confluent' }).locator('a');
  await confluentTab.click()
  await page.waitForTimeout(1000);
}

export async function closeConfluentView(page: Page): Promise<void> {
  const confluentTab = page.getByRole('tab', { name: 'Confluent' }).locator('a');
  await confluentTab.click();
  await page.waitForTimeout(1000);
}

export async function toggleConfluentView(page: Page): Promise<void> {
  const confluentTab = page.getByRole('tab', { name: 'Confluent' }).locator('a');
  await confluentTab.click();
  await page.waitForTimeout(1000);
} 