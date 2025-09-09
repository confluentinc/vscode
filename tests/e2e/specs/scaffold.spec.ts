import { expect, Page } from "@playwright/test";
import { stubMultipleDialogs } from "electron-playwright-helpers";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { test } from "../baseTest";
import { SupportView } from "../objects/views/SupportView";
import { ProjectScaffoldWebview } from "../objects/webviews/ProjectScaffoldWebview";
import { openConfluentExtension } from "./utils/confluent";

const DEFAULT_TIMEOUT_MS = 2000;

/**
 * E2E test suite for testing the Project Scaffolding functionality.
 * {@see https://github.com/confluentinc/vscode/issues/1840}
 */

/**
 * Waits for a specified amount of time and then presses a key on the Playwright page.
 * @param page - The Playwright page object.
 * @param key - The key to press, e.g., "Enter", "Escape", etc.
 * @param timeout - The time to wait before pressing the key, in milliseconds. Default is 2000ms.
 */
async function pressKey(page: Page, key: string, timeout = DEFAULT_TIMEOUT_MS) {
  await page.waitForTimeout(timeout);
  await page.keyboard.press(key, { delay: 100 });
}

test.describe("Project Scaffolding", () => {
  test.beforeEach(async ({ page }) => {
    await openConfluentExtension(page);
  });

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
        
        // Given we navigate to the Support view and start the generate project flow
        const supportView = new SupportView(page);
        await (await supportView.body.getByText("Generate Project from Template")).click();
        // and we choose a project template
        const projectTemplateInput = await page.getByPlaceholder("Select a project template");
        await expect(projectTemplateInput).toBeVisible();
        await projectTemplateInput.fill(templateName);
        await projectTemplateInput.click();
        await pressKey(page, "Enter");
        // and we provide a simple example configuration and submit the form
        const scaffoldForm = new ProjectScaffoldWebview(page);
        await (await scaffoldForm.bootstrapServersField).fill("localhost:9092");
        await scaffoldForm.submitForm();

        // When we open the generated project (the dialog stub is still in effect here)
        await pressKey(page, "ControlOrMeta+O");
        // and we open the configuration file `.env`
        await (await page.getByText(projectDirName)).click();
        await (await page.getByText(".env")).click();

        // Then we should see the generated configuration
        await expect(await page.getByText(/CC_BOOTSTRAP_SERVER\s*=\s*"localhost:9092"/)).toBeVisible();
        // and we should see a client.id starting with the expected prefix
        await expect(await page.getByText(/CLIENT_ID\s*=\s*"vscode-/)).toBeVisible();
      });
    }
  });
});
