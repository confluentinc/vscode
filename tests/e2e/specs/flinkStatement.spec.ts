import { FrameLocator } from "@playwright/test";
import { test } from "vscode-test-playwright";
import { login } from "./utils/confluentCloud";
import { enableFlink } from "./utils/flink";
import {
  stopStatement,
  submitFlinkStatement,
  verifyResultsStats,
  verifyStatementStatus,
} from "./utils/flinkStatement";

test.describe("Flink statements and statement results viewer", () => {
  let webview: FrameLocator;

  test.beforeEach(async ({ page, electronApp }) => {
    // First, login to Confluent Cloud
    await login(page, electronApp, process.env.E2E_USERNAME!, process.env.E2E_PASSWORD!);

    // Enable Flink
    await enableFlink(page);
  });

  test.afterEach(async () => {
    // Stop the statement
    await stopStatement(webview);
  });

  const testCases = [
    {
      name: "SELECT statement",
      fileName: "select.flink.sql",
      eventualExpectedStatus: "RUNNING",
      expectedStats: "Showing 1..100 of 200 results (total: 200).",
    },
    {
      name: "EXPLAIN statement",
      fileName: "explain.flink.sql",
      eventualExpectedStatus: "COMPLETED",
      expectedStats: "Showing 1..1 of 1 results (total: 1).",
    },
    {
      name: "DESCRIBE statement",
      fileName: "describe.flink.sql",
      eventualExpectedStatus: "COMPLETED",
      expectedStats: "Showing 1..5 of 5 results (total: 5).",
    },
  ];

  for (const testCase of testCases) {
    test(`should submit Flink statement - ${testCase.name}`, async ({ page }) => {
      // Submit the statement
      await submitFlinkStatement(page, testCase.fileName);

      webview = page.locator("iframe").contentFrame().locator("iframe").contentFrame();

      // Wait for statement to run and verify status
      await verifyStatementStatus(webview, testCase.eventualExpectedStatus);

      // Verify results stats
      await verifyResultsStats(webview, testCase.expectedStats);

      // TODO: Verify results are correct for each test case
    });
  }
});
