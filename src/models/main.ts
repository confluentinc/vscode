import * as vscode from "vscode";
import { IconNames } from "../constants";
/** Anything with an `id` string property */
export interface IdItem {
  readonly id: string;
}

export type KeyValuePair = [string, string | undefined];
export type KeyValuePairArray = KeyValuePair[];

/**
 * This is a custom tooltip class that extends `vscode.MarkdownString` to add constructor arguments
 * for additional properties that are not available in the base class.
 * @param value Optional, initial value.
 * @param isTrusted Whether the markdown content is trusted or not (e.g. to support embedding
 *   command-markdown syntax). (Default is `true`.)
 * @param supportHtml Whether the tooltip supports HTML content. (Default is `false`.)
 * @param supportThemeIcons Whether the tooltip supports the extension's custom contributed icons in
 *   the markdown string (e.g. `$(confluent-environment)`). (Default is `true`.)
 */
export class CustomMarkdownString extends vscode.MarkdownString {
  constructor(
    value?: string,
    public isTrusted: boolean = true,
    public supportHtml: boolean = false,
    public supportThemeIcons: boolean = true,
  ) {
    super(value, supportThemeIcons);
  }

  /**
   * Add a title with optional icon to the tooltip
   */
  addHeader(title: string, iconName?: IconNames): this {
    if (iconName) {
      this.appendMarkdown(`#### $(${iconName}) ${title}\n`);
    } else {
      this.appendMarkdown(`#### ${title}\n`);
    }
    this.appendMarkdown("\n\n---");
    return this;
  }

  /**
   * Add a standard field (key: value) to the tooltip
   */
  addField(label: string, value: string | undefined): this {
    if (value !== undefined && value !== "") {
      this.appendMarkdown(`\n\n${label}: \`${value}\``);
    }
    return this;
  }

  /**
   * Add a warning message with icon. Automatically adds a divider before each warning.
   */
  addWarning(message: string, icon: string = "warning"): this {
    this.addDivider();
    this.appendMarkdown(`\n\n$(${icon}) ${message}`);
    return this;
  }

  /**
   * Add a divider line
   */
  addDivider(): this {
    this.appendMarkdown("\n\n---");
    return this;
  }

  /**
   * Add Confluent Cloud link
   */
  addCCloudLink(url: string): this {
    if (url && url.startsWith("https://")) {
      this.addDivider();
      this.appendMarkdown(`\n\n[$(${IconNames.CONFLUENT_LOGO}) Open in Confluent Cloud](${url})`);
    }
    return this;
  }

  /**
   * Add a custom link
   */
  addLink(label: string, url: string): this {
    this.appendMarkdown(`\n\n[${label}](${url})`);
    return this;
  }
}
