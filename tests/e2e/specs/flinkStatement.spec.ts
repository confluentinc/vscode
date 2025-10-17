import type { FrameLocator } from "@playwright/test";
import { expect } from "@playwright/test";
import * as path from "path";
import { fileURLToPath } from "url";
import { test } from "../baseTest";
import { ConnectionType } from "../connectionTypes";
import { Tag } from "../tags";
import { stopStatement, submitFlinkStatement } from "../utils/flinkStatement";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe("Flink Statements", { tag: [Tag.CCloud, Tag.FlinkStatements] }, () => {
  let webview: FrameLocator;

  // tell the `connectionItem` fixture to set up a CCloud connection
  test.use({ connectionType: ConnectionType.Ccloud });

  test.beforeEach(async ({ connectionItem }) => {
    // ensure connection tree item has resources available to work with
    await expect(connectionItem.locator).toHaveAttribute("aria-expanded", "true");
  });

  test.afterEach(async () => {
    // Stop the statement
    await stopStatement(webview);
  });

  const testCases = [
    {
      name: "SELECT Statement",
      fileName: "select.flink.sql",
      eventualExpectedStatus: "RUNNING",
      expectedStats: "Showing 1..100 of 200 results (total: 200).",
    },
    {
      name: "EXPLAIN Statement",
      fileName: "explain.flink.sql",
      eventualExpectedStatus: "COMPLETED",
      expectedStats: "Showing 1..1 of 1 results (total: 1).",
    },
    {
      name: "DESCRIBE Statement",
      fileName: "describe.flink.sql",
      eventualExpectedStatus: "COMPLETED",
      expectedStats: "Showing 1..5 of 5 results (total: 5).",
    },
  ];

  for (const testCase of testCases) {
    test(`${testCase.name}: should submit Flink Statement`, async ({ page, electronApp }) => {
      // Submit the statement
      await submitFlinkStatement(
        page,
        path.join(__dirname, `../../fixtures/flinksql/${testCase.fileName}`),
        electronApp,
      );

      webview = page.locator("iframe").contentFrame().locator("iframe").contentFrame();

      await expect(webview.getByTestId("statement-status")).toHaveText(
        testCase.eventualExpectedStatus,
        {
          // If the statement was just submitted, it may take a while to transition to the new status.
          timeout: 30_000,
        },
      );

      // Assert that the result stats are correct. This is the text that appears at the bottom of
      // the Results Viewer tab, e.g. "Showing 1..100 of 200 results (total: 200)."
      await expect(webview.getByTestId("results-stats")).toHaveText(testCase.expectedStats);

      // TODO: Verify results are correct for each test case
    });
  }
});
