import { expect } from "@playwright/test";
import { Notification } from "../../notifications/Notification";
import { NotificationArea } from "../../notifications/NotificationArea";
import { ViewItem } from "./ViewItem";

export class KafkaClusterItem extends ViewItem {
  /** Start the "Generate project from resource" workflow from the right-click context menu of the Kafka cluster item. */
  async generateProject(): Promise<void> {
    await this.rightClickContextMenuAction("Generate project from resource");
  }

  /** Copy the Kafka cluster's bootstrap servers to the clipboard via the right-click context menu. */
  async copyBootstrapServers(): Promise<void> {
    await this.rightClickContextMenuAction("Copy Bootstrap Server(s)");
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
