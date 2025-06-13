import { Locator, Page } from "@playwright/test";
import { ViewItem } from "./ViewItem";

interface SignedInState {
  hasNotConnectedText: boolean;
  expandable: boolean;
}

/**
 * Object representing the "Confluent Cloud" item in the Resources {@link https://code.visualstudio.com/api/ux-guidelines/views#tree-views view}.
 * This provides the following inline actions:
 * - the "Sign In" action when signed out
 * - the "Change Organization"/"Sign Out" actions when signed in
 */
export class CCloudItem extends ViewItem {
  constructor(page: Page, locator: Locator) {
    super(page, locator);
  }

  async getSignedInState(): Promise<SignedInState> {
    const [hasNotConnectedText, expandable]: boolean[] = await Promise.all([
      this.locator.getByText("(Not Connected)").isVisible(),
      this.isExpandable(),
    ]);
    return { hasNotConnectedText, expandable };
  }

  /**
   * Check if the item description doesn't show "(Not Connected)" and is expandable, indicating that
   * the user is signed in to Confluent Cloud.
   */
  async showsSignedInState(): Promise<boolean> {
    const { hasNotConnectedText, expandable } = await this.getSignedInState();
    return !hasNotConnectedText && expandable;
  }

  /**
   * Check if the item description shows "(Not Connected)" and is not collapsible/expandable,
   * indicating that the user is signed out of Confluent Cloud.
   */
  async showsSignedOutState(): Promise<boolean> {
    const { hasNotConnectedText, expandable } = await this.getSignedInState();
    return hasNotConnectedText && !expandable;
  }

  /** Click the "Sign In" inline action on this item. */
  async clickSignIn(): Promise<void> {
    await this.locator.getByRole("button", { name: "Sign In" }).click();
  }

  /** Click the "Sign Out" inline action on this item. */
  async clickSignOut(): Promise<void> {
    await this.locator.getByRole("button", { name: "Sign Out" }).click();
  }

  /**
   * Get the (CCloud) organization name from the CCloud item text (tree item `description`).
   * Returns `null` if the user is signed out or if organization name can't be parsed for some
   * other reason.
   */
  async getOrganizationName(): Promise<string | null> {
    if (await this.showsSignedOutState()) {
      return null;
    }

    // parse the organization name from the aria-label, which should be like "Confluent Cloud <org-name>"
    const ariaLabel: string | null = await this.locator.getAttribute("aria-label");
    if (!ariaLabel) {
      return null;
    }
    const match: RegExpMatchArray | null = ariaLabel.match(/Confluent Cloud (.+)/);
    return match ? match[1] : null;
  }

  /** Click the "Change Organization" action in the CCloud item. */
  async clickChangeOrganization(): Promise<void> {
    await this.locator.getByRole("button", { name: "Change Organization" }).click();
  }
}
