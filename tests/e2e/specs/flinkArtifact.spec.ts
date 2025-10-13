import { expect, FrameLocator } from "@playwright/test";
import { test } from "../baseTest";
import { ConnectionType } from "../connectionTypes";
import { Tag } from "../tags";

test.describe("Flink Artifacts", { tag: [Tag.CCloud, Tag.FlinkArtifacts] }, () => {
  let webview: FrameLocator;

  // tell the `connectionItem` fixture to set up a CCloud connection
  test.use({ connectionType: ConnectionType.Ccloud });

  test.beforeEach(async ({ page, connectionItem }) => {
    // Open Confluent extension settings using the extension command
    await page.keyboard.press("CommandOrControl+Shift+P");
    await page.fill(
      '[placeholder="Type the name of a command to run."]',
      "Confluent: Open Settings",
    );
    await page.press('[placeholder="Type the name of a command to run."]', "Enter");

    // Wait for the settings webview to load
    await expect(page.locator("iframe")).toBeVisible({ timeout: 10000 });

    // Get the settings webview frame
    const settingsFrame = page.locator("iframe").contentFrame();
    await expect(settingsFrame.locator("body")).toBeVisible();

    // Look for Flink artifacts setting - try multiple possible selectors
    const possibleSelectors = [
      'input[data-key="confluent.flink.artifacts"]',
      'input[id*="flink.artifacts"]',
      'input[name*="flink.artifacts"]',
      'label:has-text("Flink Artifacts") input[type="checkbox"]',
      'label:has-text("Enable Flink Artifacts") input[type="checkbox"]',
      'text=Flink Artifacts >> .. >> input[type="checkbox"]',
    ];

    let artifactsSetting;
    for (const selector of possibleSelectors) {
      try {
        artifactsSetting = settingsFrame.locator(selector);
        await expect(artifactsSetting).toBeVisible({ timeout: 2000 });
        break;
      } catch {
        // Try next selector
        continue;
      }
    }

    if (!artifactsSetting) {
      // If we can't find the setting, log the available elements for debugging
      const availableInputs = await settingsFrame.locator("input").all();
      console.log(`Found ${availableInputs.length} input elements in settings`);
      throw new Error("Could not locate Flink Artifacts setting in extension settings");
    }

    // Enable the Flink artifacts setting if not already enabled
    const isChecked = await artifactsSetting.isChecked();

    if (!isChecked) {
      await artifactsSetting.check();
      await expect(artifactsSetting).toBeChecked();

      // Look for a save button or wait for auto-save indication
      const saveButton = settingsFrame.locator('button:has-text("Save")');
      if (await saveButton.isVisible({ timeout: 1000 }).catch(() => false)) {
        await saveButton.click();
      }
    }

    // Close the settings tab
    await page.keyboard.press("CommandOrControl+W");

    // Ensure we're back to the main workbench
    await expect(page.locator(".monaco-workbench")).toBeVisible();

    // Wait for the connection item to be ready
    await expect(connectionItem.locator).toHaveAttribute("aria-expanded", "true");

    // Explicitly wait for the tree to refresh after settings change
    // This is crucial - the tree needs time to update based on the new setting
    await expect(
      connectionItem.locator.locator("text=Flink Artifacts"),
    )
      .toBeVisible({ timeout: 10000 })
      .catch(() => {
        // If not visible, the setting might not have taken effect
      });
  });

  test(`should open Flink Artifacts view`, async ({ page, electronApp }) => {
    // Wait for Flink Artifacts tree item to be available (indicating setting took effect)
    const flinkArtifactsItem = page.getByTestId("tree-item-Flink Artifacts");
    await expect(flinkArtifactsItem).toBeVisible({ timeout: 15000 });

    // Click the "Flink Artifacts" view
    await flinkArtifactsItem.click();
    webview = page.locator("iframe").contentFrame().locator("iframe").contentFrame();

    // Verify the Flink Artifacts view is loaded
    await expect(webview.getByText("Flink Artifacts")).toBeVisible();
  });
});
