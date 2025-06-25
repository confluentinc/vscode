import { Locator, Page } from "@playwright/test";

/** Represents a single item in a VS Code quickpick. */
export class QuickpickItem {
  constructor(
    public readonly page: Page,
    public readonly locator: Locator,
  ) {}

  /** Checks if this item is currently enabled (not disabled). */
  async isEnabled(): Promise<boolean> {
    const disabled: string | null = await this.locator.getAttribute("aria-disabled");
    return disabled !== "true";
  }

  get icon(): Locator {
    return this.locator.locator(".quick-input-list-icon");
  }

  /**
   * Parse the codicon class name for the icon element.
   * For example, if the class is `codicon-account`, this will return `account`.
   * For multi-part icons like `codicon-confluent-kafka-cluster`, this will return `confluent-kafka-cluster`.
   */
  async iconId(): Promise<string> {
    const className: string | null = await this.icon.getAttribute("class");
    if (!className) {
      return "";
    }
    const match: RegExpMatchArray | null = className.match(/codicon-([\w-]+)/);
    return match ? match[1] : "";
  }

  get label(): Locator {
    return this.locator.locator(".quick-input-list-label");
  }

  /** Gets the separator element locator. */
  get separator(): Locator {
    return this.locator.locator(".quick-input-list-separator");
  }
}
