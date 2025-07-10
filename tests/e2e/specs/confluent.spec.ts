import { expect } from "@playwright/test";
import { stubAllDialogs } from "electron-playwright-helpers";
import { test } from "../baseTest";
import { NotificationArea } from "../objects/notifications/NotificationArea";
import { ResourcesView } from "../objects/views/ResourcesView";
import { Tag } from "../tags";
import { openConfluentSidebar } from "./utils/confluent";
import { login } from "./utils/confluentCloud";

test.describe("Extension Basics", () => {
  let resourcesView: ResourcesView;

  test.beforeEach(({ page }) => {
    resourcesView = new ResourcesView(page);
  });

  test.only(
    "should activate the extension",
    { tag: [Tag.Smoke] },
    async ({ page, electronApp }) => {
      // ignore any dialogs (access to data, keyring encryption level, etc) from popping up
      await stubAllDialogs(electronApp);

      // opening the sidebar is the most common and straightforward way to activate the extension
      await openConfluentSidebar(page);

      await expect(resourcesView.locator).toBeVisible();
      await expect(resourcesView.progress).not.toBeVisible();

      const notificationArea = new NotificationArea(page);
      const activationError = notificationArea.errorNotifications
        .filter({ hasText: /Activating extension.*failed/ })
        .first();
      // fail fast if the activation error is visible
      await expect(activationError).not.toBeVisible({ timeout: 500 });

      // if this fails, we ended up with an empty state in the Resources view that never resolved
      // to show the CCloud/local container items
      await expect(resourcesView.confluentCloudItem).toBeVisible();
      await expect(resourcesView.localItem).toBeVisible();
    },
  );

  test("should complete the CCloud sign-in flow", async ({ page, electronApp }) => {
    await openConfluentSidebar(page);

    await login(page, electronApp, process.env.E2E_USERNAME!, process.env.E2E_PASSWORD!);

    const notificationArea = new NotificationArea(page);
    const successfulSignIn = notificationArea.infoNotifications.filter({
      hasText: /Successfully signed in to Confluent Cloud/,
    });
    await expect(successfulSignIn).toHaveCount(1);

    const ccloudItem = resourcesView.confluentCloudItem;
    await expect(ccloudItem).toBeVisible();
    await expect(ccloudItem).not.toHaveText("(Not Connected)");
    await expect(ccloudItem).toHaveAttribute("aria-expanded", "true");
  });
});
