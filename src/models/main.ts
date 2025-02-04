import * as vscode from "vscode";
import { ISearchable } from "./resource";

/** Anything with an `id` string property */
export interface IdItem {
  readonly id: string;
}

/**
 * This is a basic tree item that represents a container with children, created to
 * easily group items in the tree view. Most useful when there are multiple types of
 * items nested under a single resource.
 */
export class ContainerTreeItem<T extends IdItem & ISearchable>
  extends vscode.TreeItem
  implements ISearchable
{
  private _children: T[] = [];

  constructor(
    label: string | vscode.TreeItemLabel,
    collapsibleState: vscode.TreeItemCollapsibleState,
    children: T[],
  ) {
    super(label, collapsibleState);
    // set id to the label so it isn't `undefined`; can be overwritten by the caller if needed
    this.id = label.toString();

    this.description = `(${children.length})`;

    this.children = children;
  }

  set children(children: T[]) {
    // ensure that children ids are unique
    const ids = new Set<string>();
    for (const child of children) {
      if (ids.has(child.id)) {
        throw new Error(`Duplicate id found in children: ${child.id}`);
      }
      ids.add(child.id);
    }

    this._children = children;
  }

  get children(): T[] {
    return this._children;
  }

  searchableText(): string {
    let label = this.label;
    if (this.label && typeof this.label !== "string") {
      label = (this.label as vscode.TreeItemLabel).label;
    }
    return `${label} ${this.description}`;
  }
}

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
}
