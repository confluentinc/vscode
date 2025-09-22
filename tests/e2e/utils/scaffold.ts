import { expect, Page } from "@playwright/test";
import { TextDocument } from "../objects/editor/TextDocument";
import { Notification } from "../objects/notifications/Notification";
import { NotificationArea } from "../objects/notifications/NotificationArea";
import { View } from "../objects/views/View";

/**
 * Verifies that the project was generated successfully and that its .env file holds
 * the expected configuration.
 *
 * @param page - The Playwright page object.
 * @param templateName - The identifier of the template.
 * @param bootstrapServers - The bootstrapServers configuration.
 * @param topic - The topic configuration (optional).
 */
export async function verifyGeneratedProject(
  page: Page,
  templateName: string,
  bootstrapServers: string,
  topic?: string,
) {
  // We should see that the project was generated successfully
  const notificationArea = new NotificationArea(page);
  const infoNotifications = notificationArea.infoNotifications.filter({
    hasText: "Project Generated",
  });
  await expect(infoNotifications).not.toHaveCount(0);

  // Open the generated project in the current window
  const successNotification = new Notification(page, infoNotifications.first());
  await successNotification.clickActionButton("Open in Current Window");

  // Open the configuration file .env
  const envFileName = ".env";
  const explorerView = new View(page, "Explorer");
  const envFile = explorerView.treeItems.filter({
    hasText: envFileName,
  });
  await expect(envFile).toBeVisible();
  await envFile.click();

  // Verify that the .env file holds the expected configuration
  const envDocument = new TextDocument(page, envFileName);
  await expect(envDocument.tab).toBeVisible();
  await expect(envDocument.editorContent).toBeVisible();
  // It should hold the configured bootstrapServers value
  await expect(envDocument.editorContent).toContainText(
    new RegExp(`CC_BOOTSTRAP_SERVER\\s*=\\s*"${bootstrapServers}"`),
  );
  // If a topic was provided, the .env file should specify it
  if (topic) {
    await expect(envDocument.editorContent).toContainText(
      new RegExp(`CC_TOPIC\\s*=\\s*"${topic}"`),
    );
  }
  // Also, we should see the client.id starting with `vscode-` and the template name/identifier
  await expect(envDocument.editorContent).toContainText(
    new RegExp(`CLIENT_ID\\s*=\\s*"vscode-${templateName}`),
  );
}
