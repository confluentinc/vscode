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
    const itemMatches = item.searchableText().toLowerCase().includes(searchStr);

    if (item instanceof Environment) {
      // include any nested Kafka Clusters or Schema Registries in search filtering
      const kafkaMatches = item.kafkaClusters.some((kafkaCluster) =>
        kafkaCluster.searchableText().toLowerCase().includes(searchStr),
      );
      const schemaRegistryMatches = item.schemaRegistry
        ?.searchableText()
        .toLowerCase()
        .includes(searchStr);
      if (itemMatches || kafkaMatches || schemaRegistryMatches) {
        filteredItems.push(item);
      }
      return;
    }

    if (item instanceof ContainerTreeItem) {
      // recursively filter children (e.g. "Confluent Cloud" > Environments > Kafka Clusters)
      const childrenMatches = filterSearchableItems(item.children, searchStr);
      if (itemMatches || childrenMatches.length > 0) {
        filteredItems.push(item);
      }
      return;
    }

    // TODO: add Topic/Schema match logic here

    // non-parent type, no need to check nested items
    if (itemMatches) {
      filteredItems.push(item);
    }
  });

  return filteredItems;
}
