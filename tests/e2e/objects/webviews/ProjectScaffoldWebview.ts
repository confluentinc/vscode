import { Locator } from "@playwright/test";
import { Webview } from "./Webview";

/**
 * Object representing the Project Scaffold {@link https://code.visualstudio.com/api/ux-guidelines/webviews webview}.
 */
export class ProjectScaffoldWebview extends Webview {
  get wrapper(): Locator {
    return this.webview.locator("main.webview-form");
  }

  get form(): Locator {
    return this.wrapper.locator("form.form-container");
  }

  get bootstrapServersField(): Locator {
    return this.webview.locator('[name="cc_bootstrap_server"]');
  }

  async submitForm(): Promise<void> {
    return this.webview.locator('input[type="submit"]').click();
  }
}
