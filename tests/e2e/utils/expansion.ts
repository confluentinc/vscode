import { Locator, expect } from "@playwright/test";

/** Check if an element with `aria-expanded` is currently expanded. */
export async function isExpanded(locator: Locator): Promise<boolean> {
  const ariaExpanded: string | null = await locator.getAttribute("aria-expanded");
  return ariaExpanded === "true";
}

/** Expand an element if it's not already expanded. */
export async function expand(locator: Locator): Promise<void> {
  if (!(await isExpanded(locator))) {
    await locator.click();
    await expect(locator).toHaveAttribute("aria-expanded", "true");
  }
}

/** Collapse an element if it's currently expanded. */
export async function collapse(locator: Locator): Promise<void> {
  if (await isExpanded(locator)) {
    await locator.click();
    await expect(locator).toHaveAttribute("aria-expanded", "false");
  }
}
