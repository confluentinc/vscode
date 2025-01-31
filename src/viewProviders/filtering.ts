import { Environment } from "../models/environment";
import { ContainerTreeItem } from "../models/main";
import { ISearchable } from "../models/resource";

export function filterSearchableItems(items: ISearchable[], searchStr: string): ISearchable[] {
  if (!searchStr || items.length === 0) {
    // no filtering to do
    return items;
  }

  searchStr = searchStr.toLowerCase();

  const filteredItems: ISearchable[] = [];

  items.forEach((item) => {
    // check any container-like items for nested matches since they may need to also filter their
    // children (which calls back into this function)
    if (item instanceof Environment || item instanceof ContainerTreeItem) {
      const containerLike: (Environment | ContainerTreeItem<any>) | undefined =
        item.searchContainer(searchStr);
      if (containerLike) {
        filteredItems.push(containerLike);
      }
      return;
    }

    // TODO: add Topic/Schema match logic here

    // not a "container-like" item, so just check its own searchableText
    if (item.searchableText().toLowerCase().includes(searchStr)) {
      filteredItems.push(item);
    }
  });

  return filteredItems;
}
