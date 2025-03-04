import { FileDecoration, FileDecorationProvider, ThemeColor, Uri } from "vscode";
import { ISearchable, isSearchable } from "../models/resource";

/** Check if an item matches the provided search string. */
export function itemMatchesSearch(item: ISearchable, searchStr: string): boolean {
  // if there's no search string, everything matches
  if (!searchStr) return true;
  return (
    isSearchable(item) && item.searchableText().toLowerCase().includes(searchStr.toLowerCase())
  );
}

/** Filter a list of items based on a search string. */
export function filterItems(items: ISearchable[], searchStr: string): ISearchable[] {
  if (!searchStr) {
    // if there's no search string, return items as-is
    return items;
  }
  return items.filter((item) => matchesOrHasMatchingChild(item, searchStr));
}

/** Traverse tree nodes, calling the provided callback function for each matching element. */
export function traverseMatches(
  item: ISearchable,
  searchStr: string,
  callback: (item: ISearchable) => void,
): void {
  if (itemMatchesSearch(item, searchStr)) {
    callback(item);
  }
  item.children?.forEach((child) => traverseMatches(child, searchStr, callback));
}

/** Determine whether an item directly matches the search string, or if its children do. */
export function matchesOrHasMatchingChild(item: ISearchable, searchStr: string): boolean {
  if (!searchStr) return true;
  let hasMatch = false;
  traverseMatches(item, searchStr, () => {
    hasMatch = true;
  });
  return hasMatch;
}

/** Count total number of elements matching the search string */
export function countMatchingElements(item: ISearchable, searchStr: string): number {
  if (!searchStr) return 0;
  let count = 0;
  traverseMatches(item, searchStr, () => {
    count++;
  });
  return count;
}

/** Decorator for an item in a view that matches a search string. */
const SEARCH_MATCH_DECORATION = new FileDecoration(
  "●",
  "Matches search",
  new ThemeColor("list.highlightForeground"),
);

/** Uri scheme to use when a view's tree item can be decorated to look like a search result. */
export const SEARCH_DECORATION_URI_SCHEME = "search-match";

/**
 * File decoration provider that adds a visual indicator to search results for {@link Uri}s using
 * the {@link SEARCH_DECORATION_URI_SCHEME}.
 */
export const SEARCH_DECORATION_PROVIDER: FileDecorationProvider = {
  provideFileDecoration: (uri: Uri): FileDecoration | undefined => {
    if (uri.scheme === SEARCH_DECORATION_URI_SCHEME) {
      return SEARCH_MATCH_DECORATION;
    }
  },
};
