import { TreeItem, TreeItemCollapsibleState } from "vscode";
import { ISearchable } from "../models/resource";
import { matchesOrHasMatchingChild } from "./search";

/**
 * Adjust the {@link TreeItemCollapsibleState TreeItemCollapsibleState} of a tree item that
 * was returned from a tree data provider's `getChildren()` while a search string was applied.
 */
export function updateCollapsibleStateFromSearch(
  element: ISearchable,
  treeItem: TreeItem,
  searchStr: string,
): TreeItem {
  if (!searchStr) {
    // return the tree item as-is if there's no search string or it's empty
    return treeItem;
  }

  const origCollapsibleState = treeItem.collapsibleState;

  if (element.children?.some((child) => matchesOrHasMatchingChild(child, searchStr))) {
    // has children that match the search
    treeItem.collapsibleState = TreeItemCollapsibleState.Expanded;
  } else if (element.children?.length) {
    // has children, but none of them match
    treeItem.collapsibleState = TreeItemCollapsibleState.Collapsed;
  } else {
    // leaf item
    treeItem.collapsibleState = TreeItemCollapsibleState.None;
  }

  if (treeItem.collapsibleState !== origCollapsibleState) {
    // adjust the id so we can auto-expand any currently-collapsed items that match the search
    // (or whose children match the search)
    treeItem.id = `${treeItem.id}-search`;
  }

  return treeItem;
}
