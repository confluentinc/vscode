import { Locator, Page } from "@playwright/test";
import { ViewItem } from "./ViewItem";

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

  /** The "(Not Connected)" description that appears when the user isn't signed in to CCloud. */
  get notConnectedText(): Locator {
    return this.locator.getByText("(Not Connected)");
  }

  /** Click the "Sign In" inline action on this item. */
  async clickSignIn(): Promise<void> {
    await this.clickInlineAction("Sign In");
  }

  /** Click the "Sign Out" inline action on this item. */
  async clickSignOut(): Promise<void> {
    await this.clickInlineAction("Sign Out");
  }

  /** Click the "Change Organization" action in the CCloud item. */
  async clickChangeOrganization(): Promise<void> {
    await this.clickInlineAction("Change Organization");
  }
}
