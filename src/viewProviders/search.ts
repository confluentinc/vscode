import { ISearchable, isSearchable } from "../models/resource";

/** Check if an item matches the provided search string. */
export function itemMatchesSearch(item: ISearchable, searchStr: string): boolean {
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

/** Determine whether an item directly matches the search string, or if its children do. */
export function matchesOrHasMatchingChild(item: ISearchable, searchStr: string): boolean {
  // check if the item is a direct match
  if (itemMatchesSearch(item, searchStr)) {
    return true;
  }
  // recursively check if any child matches
  if (item.children?.length) {
    return item.children.some((child) =>
      matchesOrHasMatchingChild(child as ISearchable, searchStr),
    );
  }
  return false;
}
