import { ViewItem } from "./ViewItem";

export class KafkaClusterItem extends ViewItem {
  /** Start the "Generate project from resource" workflow from the right-click context menu of the Kafka cluster item. */
  async generateProject(): Promise<void> {
    await this.rightClickContextMenuAction("Generate project from resource");
  }

  /** Copy the Kafka cluster's bootstrap servers to the clipboard via the right-click context menu. */
  async copyBootstrapServers(): Promise<void> {
    await this.rightClickContextMenuAction("Copy Bootstrap Server(s)");
  }
}
