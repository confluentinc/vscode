import { readFromClipboard } from "../../../utils/clipboard";
import { ViewItem } from "./ViewItem";

export class SchemaRegistryItem extends ViewItem {
  /** Copy the Schema Registry's URL to the clipboard via the right-click context menu. */
  async copyUrl(): Promise<string> {
    await this.rightClickContextMenuAction("Copy URL");
    return await readFromClipboard(this.page);
  }
}
