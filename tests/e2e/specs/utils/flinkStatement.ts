import { ElectronApplication, FrameLocator, Page, expect } from "@playwright/test";
import { stubMultipleDialogs } from "electron-playwright-helpers";
import path from "path";
import { TextDocument } from "../../objects/editor/TextDocument";
import { Quickpick } from "../../objects/quickInputs/Quickpick";
import { ResourcesView } from "../../objects/views/ResourcesView";
import { FlinkStatementTestIds } from "./testIds";

const TEST_ENV_NAME = "main-test-env";
const TEST_COMPUTE_POOL_NAME = "main-test-pool";
const TEST_KAFKA_CLUSTER_NAME = "main-test-cluster";

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
  // First, expand the CCloud env
  await expect(resourcesView.ccloudEnvironments).not.toHaveCount(0);
  await resourcesView.ccloudEnvironments.getByText(TEST_ENV_NAME).click();
  // Then click on a Flink compute pool
  await expect(resourcesView.ccloudFlinkComputePools).not.toHaveCount(0);
  await resourcesView.ccloudFlinkComputePools.getByText(TEST_COMPUTE_POOL_NAME).click();

  // Open the fixture file
  await stubMultipleDialogs(electronApp, [
    {
      method: "showOpenDialog",
      value: {
        filePaths: [fixtureFileName]
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
  await computePoolQuickpick.selectItemByText(TEST_COMPUTE_POOL_NAME);
  await expect(codeLens.getByText(TEST_COMPUTE_POOL_NAME)).toBeVisible();

  // Select the Kafka cluster
  await codeLens.getByText("Set Catalog & Database").click();
  const kafkaClusterQuickpick = new Quickpick(page);
  await kafkaClusterQuickpick.selectItemByText(TEST_KAFKA_CLUSTER_NAME);
  await expect(codeLens.getByText(TEST_KAFKA_CLUSTER_NAME)).toBeVisible();

  // Submit the Flink statement
  await flinkSqlDoc.codeLensActions.getByText("Submit Statement").click();

  // Move the mouse and hover over Flink Statements
  await (await page.getByLabel("Flink Statements").all())[0].hover();

  // Assert that a new Results Viewer tab with "Statement : ..." opens up
  await page.waitForSelector("text=Statement:");

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
  const stopButton = webview.getByTestId(FlinkStatementTestIds.stopStatementButton);
  const disabled = await stopButton.getAttribute("disabled");

  if (disabled === "disabled") {
    return;
  }

  // Click the stop button
  await stopButton.click();

  // Wait for the statement to be stopped
  await expect(webview.getByTestId(FlinkStatementTestIds.statementStatus)).toHaveText("STOPPED");

  // Verify the statement detail info
  await expect(webview.getByTestId(FlinkStatementTestIds.statementDetailInfo)).toHaveText(
    "This statement was stopped manually.",
  );

  // Verify no error is shown
  await expect(webview.getByTestId(FlinkStatementTestIds.statementDetailError)).toBeHidden();
}

export async function verifyStatementStatus(webview: FrameLocator, status: string) {
  await expect(webview.getByTestId(FlinkStatementTestIds.statementStatus)).toHaveText(status, {
    // If the statement was just submitted, it may take a while to transition to the new status.
    timeout: 30_000,
  });
}

/**
 * Assert that the result stats are correct. This is the text that appears at the bottom of the Results Viewer tab,
 * e.g. "Showing 1..100 of 200 results (total: 200).".
 *
 * @param webview - The webview page object.
 * @param stats - The expected result stats.
 */
export async function verifyResultsStats(webview: FrameLocator, stats: string) {
  await expect(webview.getByTestId(FlinkStatementTestIds.resultsStats)).toHaveText(stats);
}
