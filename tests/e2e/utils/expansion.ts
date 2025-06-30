import { expect, Locator } from "@playwright/test";

export const EXPANDABLE_ATTRIBUTE = "aria-expanded";

/** The same as VS Code's `TreeItemCollapsibleState`, but used for more than tree items. */
export enum CollapsibleState {
  None,
  Collapsed,
  Expanded,
}

/** Get the collapsible state of an element with `aria-expanded` attribute. */
export async function getCollapsibleState(locator: Locator): Promise<CollapsibleState> {
  try {
    // wait for the aria-expanded attribute, or time out and return None
    await expect(locator).toHaveAttribute(EXPANDABLE_ATTRIBUTE, /^(true|false)$/, {
      timeout: 1_000,
    });
    // there's a small window of time where the attribute might change between the line above and
    // this .getAttribute() call
    const ariaExpanded = await locator.getAttribute(EXPANDABLE_ATTRIBUTE);
    return ariaExpanded === "true" ? CollapsibleState.Expanded : CollapsibleState.Collapsed;
  } catch {
    return CollapsibleState.None;
  }
}

/** Set the expanded/collapsed state of an element, waiting for the state to change if needed. */
export async function setExpanded(locator: Locator, expanded: boolean): Promise<void> {
  const currentState = await getCollapsibleState(locator);
  if (currentState === CollapsibleState.None) {
    throw new Error(
      `Element "${await locator.textContent()}" is not expandable, as it has no "${EXPANDABLE_ATTRIBUTE}" attribute.`,
    );
  }

  const isExpanded = currentState === CollapsibleState.Expanded;
  if (isExpanded !== expanded) {
    await locator.click();
    // wait for the change to the intended state
    await expect(locator).toHaveAttribute(EXPANDABLE_ATTRIBUTE, expanded ? "true" : "false", {
      timeout: 1_000,
    });
  }
}

export async function expand(locator: Locator): Promise<void> {
  await setExpanded(locator, true);
}

export async function collapse(locator: Locator): Promise<void> {
  await setExpanded(locator, false);
}
