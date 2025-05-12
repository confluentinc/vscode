import { Page } from "@playwright/test";
import { DEFAULT_FLINK_SQL_FILE_EXTENSION } from "../../../src/flinkSql/constants";
import { test } from "./base";
import { login } from "./utils/confluentCloud";

async function enableFlink(page: Page) {
  // Open settings
  await (await page.getByRole("treeitem", { name: "Open Settings" })).click();
  // Go to JSON file
  await (await page.getByLabel("Open Settings (JSON)")).click();
  // Click the tab again to make sure we're focused
  await (await page.getByRole("tab", { name: "settings.json" })).click();

  await page.keyboard.press("ControlOrMeta+A");

  // HACK
  await page.keyboard.type(`{"confluent.preview.enableFlink`);
  await page.keyboard.press("Enter");
  await page.keyboard.type("true");

  // Save the file
  await page.keyboard.press("ControlOrMeta+S");

  // Close the settings file
  await (await page.getByRole("tab", { name: "settings.json" }).getByLabel("Close")).click();
}

test.describe("Flink statements and statement results", () => {
  test("should submit Flink statement", async ({ page, electronApp }) => {
    // First, login to Confluent Cloud
    await login(page, electronApp, process.env.E2E_USERNAME!, process.env.E2E_PASSWORD!);

    // Open a new file, save it and call it `select.flink.sql`
    const fileName = `select${DEFAULT_FLINK_SQL_FILE_EXTENSION}`;

    // Enable Flink
    await enableFlink(page);

    // First, expand the CCloud env
    await (await page.getByText("main-test-env")).click();

    // Click on the first Flink compute pool
    await (await page.getByText("AWS.us-east-1")).click();

    await page.keyboard.press("ControlOrMeta+P");
    await page.keyboard.type(fileName);
    await page.keyboard.press("Enter");

    // Move the mouse and hover over Flink Statements
    (await page.getByLabel("Flink Statements - main-test-env").all())[0].hover();

    // Click cloud upload icon in Flink statements view
    await (await page.getByLabel("Submit Flink Statement")).click();

    // Choose the select.flinksql file
    await page.keyboard.type(fileName);
    await page.keyboard.press("Enter");

    // Select the first compute pool
    const computePoolInput = await page.getByPlaceholder(/compute pool/);
    await computePoolInput.isVisible();
    await computePoolInput.click();
    await page.keyboard.press("Enter");

    // Select the first kafka cluster
    const kafkaClusterInput = await page.getByPlaceholder(/Kafka cluster/);
    await kafkaClusterInput.isVisible();
    await kafkaClusterInput.click();
    await page.keyboard.press("Enter");

    // Assert that a new Results Viewer tab with "Statement : ..." opens up
    await page.waitForSelector("text=Statement:");

    // TODO: Inspecting iframe properly needs some work, exercise for reader to
    //       look into it and fix.
    // Get the iframe and evaluate within its context
    // const frame = await page.waitForSelector("iframe");
    // if (!frame) {
    //   throw new Error("Results iframe not found");
    // }

    // const frameContent = await frame.contentFrame();
    // if (!frameContent) {
    //   throw new Error("Could not get iframe content");
    // }

    // // Wait for and check the results within the iframe context
    // const iframePage = await frameContent.page();
    // NOT WORKING
    // await expect(iframePage.getByTestId("results-stats")).toHaveText("200 results");
  });
});
