import { expect } from "@playwright/test";
import { Notification } from "../../notifications/Notification";
import { NotificationArea } from "../../notifications/NotificationArea";
import { ViewItem } from "./ViewItem";

export class SchemaRegistryItem extends ViewItem {
  /** Copy the Schema Registry's URI to the clipboard via the right-click context menu. */
  async copyUri(): Promise<void> {
    await this.rightClickContextMenuAction("Copy URI");
    // don't resolve until the "Copied ... to clipboard." info notification appears and is dismissed
    const notificationArea = new NotificationArea(this.page);
    const copyNotifications = notificationArea.infoNotifications.filter({
      hasText: /Copied ".*" to clipboard./,
    });
    await expect(copyNotifications).toHaveCount(1);
    const notification = new Notification(this.page, copyNotifications.first());
    await notification.dismiss();
  }
}
