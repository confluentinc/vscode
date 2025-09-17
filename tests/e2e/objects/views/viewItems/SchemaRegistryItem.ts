import { ViewItem } from "./ViewItem";

export class SchemaRegistryItem extends ViewItem {
  /** Copy the Schema Registry's URI to the clipboard via the right-click context menu. */
  async copyUri(): Promise<void> {
    await this.rightClickContextMenuAction("Copy URI");
  }
}
