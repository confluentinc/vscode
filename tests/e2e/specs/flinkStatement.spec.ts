import type { FrameLocator } from "@playwright/test";
import { expect } from "@playwright/test";
import * as path from "path";
import { fileURLToPath } from "url";
import { test } from "../baseTest";
import { FlinkStatementsView } from "../objects/views/FlinkStatementsView";
import { Tag } from "../tags";
import { ConnectionType } from "../types/connection";
import { stopStatement, submitFlinkStatement } from "../utils/flinkStatement";
import { openConfluentSidebar } from "../utils/workspace";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe("Flink Statements", { tag: [Tag.CCloud, Tag.FlinkStatements] }, () => {
  let webview: FrameLocator | undefined;
  let statementName: string | undefined;

  // tell the `connectionItem` fixture to set up a CCloud connection
  test.use({ connectionType: ConnectionType.Ccloud });

  test.beforeEach(async ({ connectionItem }) => {
    // ensure connection tree item has resources available to work with
    await expect(connectionItem.locator).toHaveAttribute("aria-expanded", "true");
    webview = undefined;
    statementName = undefined;
  });

  test.afterEach(async ({ page }) => {
    if (!statementName) {
      // submit failed before a statement was created; nothing to clean up
      return;
    }
    // stop the statement (no-op if it already reached a terminal state) so it becomes deletable,
    // then delete it - there is no global cleanup sweep, so each test removes its own statement
    if (webview) {
      await stopStatement(webview);
    }
    // the statement results open in an editor webview, so re-focus the Confluent sidebar before
    // operating on the Flink Statements tree view (mirrors the topic fixture teardown)
    await openConfluentSidebar(page);
    await new FlinkStatementsView(page).deleteStatement(statementName);
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
      // Submit the statement (capturing its name so afterEach can delete it)
      statementName = await submitFlinkStatement(
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
