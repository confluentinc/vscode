import { Locator, Page } from "@playwright/test";
import { ViewItem } from "./ViewItem";

/**
 * Object representing the "Local" item in the Resources {@link https://code.visualstudio.com/api/ux-guidelines/views#tree-views view}.
 * This is used for:
 * - the "Start Local Resources" action when any extension-managed resources (Kafka cluster, Schema
 * Registry, etc.) are not running
 * - the "Stop Local Resources" action when any extension-managed resources are running
 */
export class LocalItem extends ViewItem {
  constructor(page: Page, locator: Locator) {
    super(page, locator);
  }

  get startLocalResourcesButton(): Locator {
    return this.locator.getByRole("button", { name: "Start Local Resources" });
  }

  /** Check if local resources can be started. */
  async canStartLocalResources(): Promise<boolean> {
    return await this.startLocalResourcesButton.isVisible();
  }

  /** Click the "Start Local Resources" action on the Local item. */
  async clickStartLocalResources(): Promise<void> {
    await this.startLocalResourcesButton.click();
  }

  get stopLocalResourcesButton(): Locator {
    return this.locator.getByRole("button", { name: "Stop Local Resources" });
  }

  /** Check if local resources are currently running (Stop Local Resources button is available). */
  async canStopLocalResources(): Promise<boolean> {
    return await this.stopLocalResourcesButton.isVisible();
  }

  /** Click the "Stop Local Resources" action on the Local item. */
  async clickStopLocalResources(): Promise<void> {
    await this.stopLocalResourcesButton.click();
  }
}
