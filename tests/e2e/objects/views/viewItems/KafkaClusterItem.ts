import { ViewItem } from "./ViewItem";

export class KafkaClusterItem extends ViewItem {
  /** Start the "Generate project from resource" workflow from the right-click context menu of the Kafka cluster item. */
  async generateProject(): Promise<void> {
    await this.rightClickContextMenuAction("Generate project from resource");
  }
}
