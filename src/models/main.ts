import * as vscode from "vscode";

/**
 * This is a basic tree item that represents a container with children, created to
 * easily group items in the tree view. Most useful when there are multiple types of
 * items nested under a single resource.
 */
export class ContainerTreeItem<T> extends vscode.TreeItem {
  children: T[] = [];

  constructor(label: string, collapsibleState: vscode.TreeItemCollapsibleState, children: T[]) {
    super(label, collapsibleState);

    this.children = children;
    this.description = `(${children.length})`;
  }
}
