import { Environment } from "../models/environment";
import { KafkaCluster } from "../models/kafkaCluster";
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
      if (itemMatches) {
        // something about the environment matched on its own
        filteredItems.push(item);
      } else {
        // include any nested Kafka Clusters or Schema Registries in search filtering
        const kafkaMatches = item.kafkaClusters.some((kafkaCluster) =>
          kafkaCluster.searchableText().toLowerCase().includes(searchStr),
        );
        if (kafkaMatches) {
          item.kafkaClusters = filterSearchableItems(
            item.kafkaClusters,
            searchStr,
          ) as KafkaCluster[];
        } else {
          // remove all Kafka Clusters if none match
          item.kafkaClusters = [];
        }

        const schemaRegistryMatches = item.schemaRegistry
          ?.searchableText()
          .toLowerCase()
          .includes(searchStr);
        if (!schemaRegistryMatches) {
          // remove it if it doesn't match
          item.schemaRegistry = undefined;
        }

        if (kafkaMatches || schemaRegistryMatches) {
          filteredItems.push(item);
        }
      }
      return;
    }

    if (item instanceof ContainerTreeItem) {
      if (itemMatches) {
        // something about the container matched on its own
        filteredItems.push(item);
      } else {
        // recursively filter children (e.g. "Confluent Cloud" > Environments > Kafka Clusters)
        const childrenMatches = filterSearchableItems(item.children, searchStr);
        if (childrenMatches.length > 0) {
          // don't return all children, just the ones that matched
          item.children = childrenMatches;
          filteredItems.push(item);
        }
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
