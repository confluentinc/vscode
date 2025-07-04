import { FrameLocator, Page, expect } from "@playwright/test";
import { FlinkStatementTestIds } from "./testIds";

/**
 * Waits for a specified amount of time and then presses a key on the Playwright page.
 * @param page - The Playwright page object.
 * @param key - The key to press, e.g., "Enter", "Escape", etc.
 * @param timeout - The time to wait before pressing the key, in milliseconds. Default is 2000ms.
 */
async function pressKey(page: Page, key: string, timeout = 2000) {
  await page.waitForTimeout(timeout);
  await page.keyboard.press(key, { delay: 100 });
}

/**
 * Submit a Flink statement to Confluent Cloud.
 *
 * @param page - The Playwright page object.
 * @param fileName - The name of the Flink SQL file to submit. Must be present in the `tests/fixtures` directory.
 */
export async function submitFlinkStatement(page: Page, fileName: string) {
  // First, expand the CCloud env
  await (await page.getByText("main-test-env")).click();

  // Click on a Flink compute pool
  await (await page.getByText("GCP.us-west2")).click();

  await openFixtureFile(page, fileName);

  // Select the Flink compute pool
  await page.waitForTimeout(1000);
  await (await page.getByText("Set Compute Pool")).click();
  const computePoolInput = await page.getByPlaceholder("Select a Flink compute pool");
  await computePoolInput.isVisible();
  await computePoolInput.fill("GCP.us-west2");
  await computePoolInput.click();
  await pressKey(page, "Enter");

  // Select the Kafka cluster
  await page.waitForTimeout(1000);
  await (await page.getByText("Set Catalog & Database")).click();
  const kafkaClusterInput = await page.getByPlaceholder("Select the Kafka cluster to use as the default database for the statement");
  await kafkaClusterInput.isVisible();
  await kafkaClusterInput.fill("main-test-cluster");
  await kafkaClusterInput.click();
  await pressKey(page, "Enter");

  // Submit the Flink statement
  await (await page.getByText("Submit Statement")).click();

  // Move the mouse and hover over Flink Statements
  (await page.getByLabel("Flink Statements (Preview) - main-test-env").all())[0].hover();

  // Assert that a new Results Viewer tab with "Statement : ..." opens up
  await page.waitForSelector("text=Statement:");

  // We don't make assumptions about whether the statement will go into RUNNING state or not.
  // That's up to the caller to decide.
}

export async function openFixtureFile(page: Page, fileName: string) {
  // Could be interrupted by other events while typing.
  await pressKey(page, "ControlOrMeta+P");
  const input = await page.getByPlaceholder("Search files by name");
  await input.isVisible();
  await input.fill(fileName);
  await pressKey(page, "Enter");
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

export interface FlinkStatementTestParams {
  fileName: string;
  eventualExpectedStatus: string;
  expectedStats: string;
  timeout?: number;
}

/**
 * Helper function to test Flink statement execution with common assertions.
 *
 * @param page - The Playwright page object
 * @param params - Test parameters including file name and expected results
 */
export async function testFlinkStatement(page: Page, params: FlinkStatementTestParams) {
  // Submit the statement
  await submitFlinkStatement(page, params.fileName);

  const webview = page.locator("iframe").contentFrame().locator("iframe").contentFrame();

  // Assert that we can see the columns immediately.
  await expect(webview.getByTestId(FlinkStatementTestIds.columnRow)).toBeVisible();

  // Wait for statement to run and verify status
  await verifyStatementStatus(webview, params.eventualExpectedStatus);

  // Verify results stats
  await verifyResultsStats(webview, params.expectedStats);
}
