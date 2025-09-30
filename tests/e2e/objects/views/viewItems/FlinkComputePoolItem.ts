import { ViewItem } from "./ViewItem";

export class FlinkComputePoolItem extends ViewItem {
  /** Start the "Generate project from resource" workflow from the right-click context menu of the Flink compute pool item. */
  async generateProject(): Promise<void> {
    await this.rightClickContextMenuAction("Generate project from resource");
  }
}
