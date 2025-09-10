import { expect } from "@playwright/test";
import { stubMultipleDialogs } from "electron-playwright-helpers";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { test } from "../baseTest";
import { TextDocument } from "../objects/editor/TextDocument";
import { Notification } from "../objects/notifications/Notification";
import { NotificationArea } from "../objects/notifications/NotificationArea";
import { Quickpick } from "../objects/quickInputs/Quickpick";
import { SupportView } from "../objects/views/SupportView";
import { View } from "../objects/views/View";
import { ProjectScaffoldWebview } from "../objects/webviews/ProjectScaffoldWebview";
import { openConfluentExtension } from "./utils/confluent";

/**
 * E2E test suite for testing the Project Scaffolding functionality.
 * {@see https://github.com/confluentinc/vscode/issues/1840}
 */

test.describe("Project Scaffolding", () => {
  test.beforeEach(async ({ page }) => {
    await openConfluentExtension(page);
  });

  // Templates covered by the E2E tests
  // Mapping of display names to template names
  const templates: Array<[string, string]> = [
    ["Kafka Client in Go", "go-client"],
    ["Kafka Client in Java", "java-client"],
    ["Kafka Client in JavaScript", "javascript-client"],
    ["Kafka Client in .NET", "dotnet-client"],
  ];
  
  test.describe("Support view", () => {
    for (const [templateName, projectDirName] of templates) {
      test(`should generate ${templateName} template from Support view`, async ({
        page,
        electronApp,
      }) => {
        // Stub the showOpen dialog
        // Will lead to the generated project being stored in a temp directory
        const tmpProjectDir = mkdtempSync(path.join(tmpdir(), "vscode-test-scaffold-"));
        await stubMultipleDialogs(electronApp, [
          {
            method: "showOpenDialog",
            value: {
              filePaths: [tmpProjectDir]
            },
          },
        ]);
        
        // Given we navigate to the Support view
        const supportView = new SupportView(page);
        // and we start the generate project flow
        const projectTreeItem = supportView.treeItems.filter({
          hasText: "Generate Project from Template",
        });
        await expect(projectTreeItem).toHaveCount(1);
        await projectTreeItem.click();
        // and we choose a project template from the quickpick
        const projectQuickpick = new Quickpick(page);
        await projectQuickpick.textInput.fill(templateName);
        const projectTemplateInput = projectQuickpick.items.filter({ hasText: templateName });
        await expect(projectTemplateInput).not.toHaveCount(0);
        await projectTemplateInput.first().click();
        // and we provide a simple example configuration and submit the form
        const scaffoldForm = new ProjectScaffoldWebview(page);
        await (await scaffoldForm.bootstrapServersField).fill("localhost:9092");

        // When we submit the form
        await scaffoldForm.submitForm();
        // Then we should see that the project was generated successfully
        const notificationArea = new NotificationArea(page);
        const infoNotifications = notificationArea.infoNotifications.filter({
          hasText: "Project Generated",
        });
        await expect(infoNotifications).toHaveCount(1);
        const successNotification = new Notification(page, infoNotifications.first());
        await successNotification.clickActionButton("Open in Current Window");

        // When we open the configuration file .env
        const envFileName = ".env";
        const explorerView = new View(page, "Explorer");
        const envFile = explorerView.treeItems.filter({
          hasText: envFileName,
        });
        await expect(envFile).toBeVisible();
        await envFile.click();
        // Then we should see the generated configuration
        const envDocument = new TextDocument(page, envFileName);
        await expect(envDocument.tab).toBeVisible();
        await expect(envDocument.editorContent).toBeVisible();
        await expect(envDocument.editorContent).toContainText(
          /CC_BOOTSTRAP_SERVER\s*=\s*"localhost:9092"/,
        );
        // and we should see the client.id starting with the expected prefix
        await expect(envDocument.editorContent).toContainText(/CLIENT_ID\s*=\s*"vscode-/);
      });
    }
  });
});
