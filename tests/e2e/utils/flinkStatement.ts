import type { ElectronApplication, FrameLocator, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { stubMultipleDialogs } from "electron-playwright-helpers";
import path from "path";
import { TextDocument } from "../objects/editor/TextDocument";
import { Quickpick } from "../objects/quickInputs/Quickpick";
import { ResourcesView } from "../objects/views/ResourcesView";
import { ViewItem } from "../objects/views/viewItems/ViewItem";

/**
 * Submit a Flink statement to Confluent Cloud.
 *
 * @param page - The Playwright page object.
 * @param fileName - The name of the Flink SQL file to submit. Must be present in the `tests/fixtures` directory.
 */
export async function submitFlinkStatement(
  page: Page,
  fixtureFileName: string,
  electronApp: ElectronApplication,
) {
  const resourcesView = new ResourcesView(page);
  // First, expand a CCloud env
  await expect(resourcesView.ccloudEnvironments).not.toHaveCount(0);
  await resourcesView.ccloudEnvironments.first().click();
  // Then click on a Flink compute pool to open the Flink Statements view
  await expect(resourcesView.ccloudFlinkComputePools).not.toHaveCount(0);
  const computePoolLocator = resourcesView.ccloudFlinkComputePools.first();
  await computePoolLocator.click();

  // Grant clipboard permission for reading the copied compute pool name
  await electronApp.context().grantPermissions(["clipboard-read"]);
  const computePoolItem = new ViewItem(page, computePoolLocator);
  await computePoolItem.rightClickContextMenuAction("Copy Name");
  const computePoolName = await page.evaluate(async () => await navigator.clipboard.readText());

  // Open the fixture file
  await stubMultipleDialogs(electronApp, [
    {
      method: "showOpenDialog",
      value: {
        filePaths: [fixtureFileName],
      },
    },
  ]);
  await page.keyboard.press("ControlOrMeta+O");
  const flinkSqlDoc = new TextDocument(page, path.basename(fixtureFileName));
  // Wait for the CodeLens actions to show up
  await expect(flinkSqlDoc.tab).toBeVisible();
  const codeLens = flinkSqlDoc.codeLensActions;

  // Select the Flink compute pool
  await codeLens.getByText("Set Compute Pool").click();
  const computePoolQuickpick = new Quickpick(page);
  await computePoolQuickpick.selectItemByText(computePoolName);
  await expect(codeLens.getByText(computePoolName)).toBeVisible();

  // Select a Kafka cluster (auto-filters to cloud provider/region matching the pool)
  await codeLens.getByText("Set Catalog & Database").click();
  const kafkaClusterQuickpick = new Quickpick(page);
  await kafkaClusterQuickpick.items.first().click();

  // Submit the Flink statement
  await flinkSqlDoc.codeLensActions.getByText("Submit Statement").click();

  // Move the mouse and hover over Flink Statements
  await (await page.getByLabel("Flink Statements").all())[0].hover();

  // Assert that a new Results Viewer tab with "Statement : ..." opens up
  await expect(page.getByRole("tab", { name: /^Statement: / })).toBeVisible();

  // We don't make assumptions about whether the statement will go into RUNNING state or not.
  // That's up to the caller to decide.
}

/**
 * Stop a Flink statement.
 *
 * @param webview - The webview page object.
 */
export async function stopStatement(webview: FrameLocator) {
  // Check if the stop button is disabled
  const stopButton = webview.getByTestId("stop-statement-button");
  const disabled = await stopButton.getAttribute("disabled");

  if (disabled === "disabled") {
    return;
  }

  // Click the stop button
  await stopButton.click();

  // Wait for the statement to be stopped
  await expect(webview.getByTestId("statement-status")).toHaveText("STOPPED");

  // Verify the statement detail info
  await expect(webview.getByTestId("statement-detail-info")).toHaveText(
    "This statement was stopped manually.",
  );

  // Verify no error is shown
  await expect(webview.getByTestId("statement-detail-error")).toBeHidden();
}
