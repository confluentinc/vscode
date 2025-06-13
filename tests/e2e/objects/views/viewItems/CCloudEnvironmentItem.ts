import { Locator, Page } from "@playwright/test";
import { ViewItem } from "./ViewItem";

export class CCloudEnvironmentItem extends ViewItem {
  constructor(page: Page, locator: Locator) {
    super(page, locator);
  }
}
