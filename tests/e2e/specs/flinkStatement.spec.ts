import { FrameLocator } from "@playwright/test";
import * as path from "path";
import { fileURLToPath } from "url";
import { test } from "../baseTest";
import { openConfluentExtension } from "./utils/confluent";
import { login } from "./utils/confluentCloud";
import {
  stopStatement,
  submitFlinkStatement,
  verifyResultsStats,
  verifyStatementStatus,
} from "./utils/flinkStatement";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename)

test.describe("Flink Statements", () => {
  let webview: FrameLocator;

  test.beforeEach(async ({ page, electronApp }) => {
    // Open the extension
    await openConfluentExtension(page);

    // Login to Confluent Cloud
    await login(page, electronApp, process.env.E2E_USERNAME!, process.env.E2E_PASSWORD!);
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
    test(`${testCase.name}: should submit Flink statement`, async ({ page }) => {
      // Submit the statement
      await submitFlinkStatement(
        page,
        path.join(__dirname, `../../fixtures/flinksql/${testCase.fileName}`)
      );

      webview = page.locator("iframe").contentFrame().locator("iframe").contentFrame();

      // Wait for statement to run and verify status
      await verifyStatementStatus(webview, testCase.eventualExpectedStatus);

      // Verify results stats
      await verifyResultsStats(webview, testCase.expectedStats);

      // TODO: Verify results are correct for each test case
    });
  }
});
