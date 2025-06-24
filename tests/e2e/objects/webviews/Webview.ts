import { Page } from "@playwright/test";

/**
 * Object representing a
 * {@link https://code.visualstudio.com/api/ux-guidelines/webviews webview}.
 */
export class Webview {
  constructor(public page: Page) {}

  get locator() {
    return this.page.locator("iframe.webview");
  }

  /**
   * The actual webview content frame, which is a nested iframe inside the main webview panel.
   *
   * If you open the developer tools in VS Code, you should see the following structure:
   * - `div webview-editor-element-<uuid4>`
   *   - `iframe.webview[.ready]`
   *     - `vscode-webview://` (HTML) document
   *       - `iframe#active-frame`   <-- this is the part we want to interact with
   */
  get webview() {
    return this.locator.contentFrame().locator("iframe").contentFrame();
  }
}
