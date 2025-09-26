import { DirectConnectionForm } from "../../webviews/DirectConnectionFormWebview";
import { ViewItem } from "./ViewItem";

export class DirectConnectionItem extends ViewItem {
  /** Click the "Export connection details" inline action to export the connection details to a JSON file. */
  async clickExportConnectionDetails(): Promise<void> {
    await this.clickInlineAction("Export connection details");
  }

  /** Click the "Edit connection" inline action to open the direct connection form. */
  async clickEditConnection(): Promise<DirectConnectionForm> {
    await this.clickInlineAction("Edit connection");
    return new DirectConnectionForm(this.page);
  }

  /** Click the "Disconnect" inline action to remove the direct connection. */
  async clickDisconnect(): Promise<void> {
    await this.clickInlineAction("Disconnect");
  }
}
