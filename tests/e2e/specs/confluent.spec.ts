import { expect } from "@playwright/test";
import { test } from "../baseTest";
import { NotificationArea } from "../objects/notifications/NotificationArea";
import { ResourcesView } from "../objects/views/ResourcesView";
import { CCloudConnectionItem } from "../objects/views/viewItems/CCloudConnectionItem";
import { Tag } from "../tags";
import { NOT_CONNECTED_TEXT, setupCCloudConnection } from "../utils/connections";
import { openConfluentSidebar } from "../utils/sidebarNavigation";

test.describe(() => {
  test("should activate the extension", { tag: [Tag.Smoke] }, async ({ page }) => {
    await openConfluentSidebar(page);

    const notificationArea = new NotificationArea(page);
    await expect(notificationArea.errorNotifications).toHaveCount(0);
  });

  test(
    "should complete the browser-based Confluent Cloud sign-in flow",
    { tag: [Tag.CCloud] },
    async ({ page, electronApp }) => {
      await openConfluentSidebar(page);

      await setupCCloudConnection(
        page,
        electronApp,
        process.env.E2E_USERNAME!,
        process.env.E2E_PASSWORD!,
      );

      const resourcesView = new ResourcesView(page);
      const ccloudItem = new CCloudConnectionItem(page, resourcesView.confluentCloudItem);
      await expect(ccloudItem.locator).not.toContainText(NOT_CONNECTED_TEXT);
    },
  );
});
