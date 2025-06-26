import { expect, Locator } from "@playwright/test";

export const EXPANDABLE_ATTRIBUTE = "aria-expanded";

/** Whether an element has the `aria-expanded` attribute, indicating it can be expanded or collapsed.*/
export async function isExpandable(locator: Locator): Promise<boolean> {
  const hasAriaExpanded: string | null = await locator.getAttribute(EXPANDABLE_ATTRIBUTE);
  return hasAriaExpanded !== null;
}

/** Whether or not an element with `aria-expanded` is currently expanded. */
export async function isExpanded(locator: Locator): Promise<boolean> {
  if (!(await isExpandable(locator))) {
    throw new Error(
      `Element "${await locator.textContent()}" is not expandable, as it has no "${EXPANDABLE_ATTRIBUTE}" attribute.`,
    );
  }
  const ariaExpanded: string | null = await locator.getAttribute(EXPANDABLE_ATTRIBUTE);
  return ariaExpanded === "true";
}

/** Expand an element if it's not already expanded. */
export async function expand(locator: Locator): Promise<void> {
  if (!(await isExpanded(locator))) {
    await locator.click();
    // wait for the element to be expanded after clicking
    await expect(locator).toHaveAttribute(EXPANDABLE_ATTRIBUTE, "true");
  }
}

/** Collapse an element if it's currently expanded. */
export async function collapse(locator: Locator): Promise<void> {
  if (await isExpanded(locator)) {
    await locator.click();
    // wait for the element to be collapsed after clicking
    await expect(locator).toHaveAttribute(EXPANDABLE_ATTRIBUTE, "false");
  }
}
