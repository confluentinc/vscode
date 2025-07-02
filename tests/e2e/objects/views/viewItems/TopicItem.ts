import { MessageViewerWebview } from "../../webviews/MessageViewerWebview";
import { ViewItem } from "./ViewItem";

export class TopicItem extends ViewItem {
  /** Click the "View Messages" inline action to open the Message Viewer. */
  async viewMessages(): Promise<MessageViewerWebview> {
    await this.clickInlineAction("View Messages");
    return new MessageViewerWebview(this.page);
  }
}
