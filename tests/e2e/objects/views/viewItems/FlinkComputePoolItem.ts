import { ViewItem } from "./ViewItem";

export class FlinkComputePoolItem extends ViewItem {
  /** Start the "Generate project from resource" workflow from the right-click context menu of the Flink compute pool item. */
  async generateProject(): Promise<void> {
    await this.rightClickContextMenuAction("Generate project from resource");
  }

  /**
   * Get the provider/region string from the compute pool item's description.
   * @returns The provider/region in format "PROVIDER/region" (e.g., "AWS/us-east-2")
   */
  async getProviderRegion(): Promise<string> {
    const descriptionText = await this.description.textContent();
    if (!descriptionText) {
      throw new Error("Compute pool description not found");
    }
    return descriptionText.trim();
  }
}
