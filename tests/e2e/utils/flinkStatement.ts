import type { ElectronApplication, FrameLocator, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { stubMultipleDialogs } from "electron-playwright-helpers";
import path from "path";
import { TextDocument } from "../objects/editor/TextDocument";
import { Quickpick } from "../objects/quickInputs/Quickpick";
import { ResourcesView } from "../objects/views/ResourcesView";
import { FlinkComputePoolItem } from "../objects/views/viewItems/FlinkComputePoolItem";
import { CCLOUD_KAFKA_CLUSTER_NAME } from "../test-resources";
import { ConnectionType } from "../types/connection";

/**
 * Submit a Flink statement to Confluent Cloud, using the CCloud environment, compute pool, and
 * Kafka cluster names configured in `test-resources.ts`.
 *
 * @param page - The Playwright page object.
 * @param fixtureFileName - The Flink SQL file to submit. Must be present in `tests/fixtures`.
 * @param electronApp - The Playwright Electron app handle, used for stubbing the open-file dialog.
 * @returns The auto-generated name of the submitted statement, so the caller can delete it in
 *   teardown (see {@link FlinkStatementsView.deleteStatement}).
 */
export async function submitFlinkStatement(
  page: Page,
  fixtureFileName: string,
  electronApp: ElectronApplication,
): Promise<string> {
  const resourcesView = new ResourcesView(page);
  // expand the pinned CCloud env so the compute pools render under it
  await resourcesView.expandConnectionEnvironment(ConnectionType.Ccloud);
  // pick the pinned compute pool to open the Flink Statements view
  const computePoolLocator = await resourcesView.getFlinkComputePool(ConnectionType.Ccloud);
  await computePoolLocator.click();

  const computePoolItem = new FlinkComputePoolItem(page, computePoolLocator);
  const computePoolName = await computePoolItem.copyName();

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
  await computePoolQuickpick.selectItemByText(computePoolName, { exact: true });
  await expect(codeLens.getByText(computePoolName)).toBeVisible();

  // Select a Kafka cluster (the quickpick auto-filters to clouds/regions matching the pool, but
  // there can still be multiple matches; pin via the configured name so we never pick the wrong one)
  await codeLens.getByText("Set Catalog & Database").click();
  const kafkaClusterQuickpick = new Quickpick(page);
  await kafkaClusterQuickpick.selectItemByText(CCLOUD_KAFKA_CLUSTER_NAME, { exact: true });

  // Submit the Flink statement
  await flinkSqlDoc.codeLensActions.getByText("Submit Statement").click();

  // Move the mouse and hover over Flink Statements
  await (await page.getByLabel("Flink Statements").all())[0].hover();

  // Assert that a new Results Viewer tab with "Statement: ..." opens up, and read the
  // auto-generated statement name from its title so the caller can clean it up.
  const statementTab = page.getByRole("tab", { name: /^Statement: / });
  await expect(statementTab).toBeVisible();
  const tabLabel = (await statementTab.getAttribute("aria-label")) ?? "";
  const nameMatch = /Statement:\s*([^\s,]+)/.exec(tabLabel);
  if (!nameMatch) {
    throw new Error(
      `[E2E] could not parse the statement name from the results tab label: ${JSON.stringify(tabLabel)}`,
    );
  }

  // We don't make assumptions about whether the statement will go into RUNNING state or not.
  // That's up to the caller to decide.
  return nameMatch[1];
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
