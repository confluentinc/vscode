import { Page, expect } from "@playwright/test";
import { stubMultipleDialogs } from "electron-playwright-helpers";
import { test } from "vscode-test-playwright";
import { openConfluentExtension } from "./utils/confluent";
import { login } from "./utils/confluentCloud";
import { openFixtureFile } from "./utils/flinkStatement";

async function createNewSubject(page: Page, subjectName: string, schemaFile: string) {
  await openFixtureFile(page, schemaFile);

  await page.getByLabel(/Schemas.*Section/).click();
  await page.getByLabel(/Schemas.*Section/).hover();
  await page.getByLabel("Select Schema Registry").click();
  await expect(page.getByPlaceholder("Select a Schema Registry")).toBeVisible();
  await page.getByPlaceholder("Select a Schema Registry").click();

  // Select the first option.
  await page.keyboard.press("Enter");

  await page.getByLabel(/Schemas.*Section/).hover();
  await page.getByLabel("Upload Schema to Schema Registry", { exact: true }).click();

  await page.getByPlaceholder("Select a file").click();
  await page.keyboard.type(schemaFile);
  await page.keyboard.press("Enter");

  await page.getByText("Create new subject").click();
  await page.getByLabel("Schema Subject").click();
  await page.getByLabel("Schema Subject").press("ControlOrMeta+a");
  await page.getByLabel("Schema Subject").fill(subjectName);
  await page.getByLabel("Schema Subject").press("Enter");

  await expect(
    page.getByText(/Schema registered to new subject.*/, { exact: true }).first(),
  ).toBeVisible();
}

async function evolveSchema(page: Page, subjectName: string, fixtureFile: string) {
  await openFixtureFile(page, fixtureFile);
  // Copy the schema to the clipboard.
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+c");

  await page.getByLabel(subjectName).first().hover({ timeout: 200 });
  await page.getByRole("button", { name: "Evolve Latest Schema" }).click();
  // Wait for the unsaved schema document to open.
  await page.waitForTimeout(1000);

  await page.getByRole("tab", { name: subjectName }).first().click();
  // Wait for the tab to be focused.
  await page.waitForTimeout(200);
  // Paste the schema into the tab.
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("ControlOrMeta+v");

  // The unsaved file buffer will start with the subject name, so we can just use that.
  await uploadSchema(page, subjectName);
}

/**
 * Upload a schema to the Schema Registry. Caller is expected to have opened
 * and focused the file buffer with the schema to upload.
 *
 * @param page - The Playwright page object.
 * @param subjectName - The name of the subject to upload the schema to.
 */
async function uploadSchema(page: any, subjectName: string) {
  await page.getByLabel(/Schemas.*Section/).hover();
  await expect(page.getByLabel("Upload Schema to Schema Registry", { exact: true })).toBeVisible();
  await page.getByLabel("Upload Schema to Schema Registry", { exact: true }).click();

  await expect(page.getByPlaceholder("Select a file")).toBeVisible();
  await page.getByPlaceholder("Select a file").click();
  // Select the first option.
  await page.keyboard.press("Enter");

  await page.keyboard.type("AVRO");
  await page.keyboard.press("Enter");

  await page.keyboard.type(subjectName);
  await page.keyboard.press("Enter");
}

async function deleteSubject(page: any, subjectName: string) {
  await page.keyboard.press("Shift+ControlOrMeta+P");
  await page.keyboard.type("Delete Subject");
  await page.keyboard.press("Enter");

  await expect(page.getByPlaceholder("Select existing subject")).toBeVisible();
  await page.keyboard.type(subjectName);
  await page.keyboard.press("Enter");

  await page.getByLabel("Hard Delete").click();

  const validationMessage = await page
    .getByPlaceholder(/Enter "hard .*" to confirm/)
    .getAttribute("placeholder");
  const match = validationMessage?.match(/Enter "hard (.*)" to confirm/);
  if (match) {
    const requiredText = match[1];
    await page.keyboard.type(`hard ${requiredText}`);
    await page.keyboard.press("Enter");
  }

  await expect(
    page.getByText(/Subject customer-.*-value and.*hard deleted./, { exact: true }).first(),
  ).toBeVisible();
}

test.describe("Schema related functionality", () => {
  let subjectName: string;

  test.beforeEach(async ({ page }) => {
    await openConfluentExtension(page);
  });

  test.afterEach(async ({ page }) => {
    if (subjectName) {
      await deleteSubject(page, subjectName);
    }
  });

  /**
   * Steps:
   * 1. Create a new subject.
   * 2. Evolve the schema using an incompatible schema and verify that the evolution fails.
   * 3. Evolve the schema using a compatible schema and verify that the evolution succeeds.
   * 4. Delete the subject.
   */
  async function testSchemaEvolution({ page }: { page: Page }) {
    const randomValue = Math.random().toString(36).substring(2, 15);
    subjectName = `customer-${randomValue}-value`;

    await createNewSubject(page, subjectName, "customer.avsc");
    await evolveSchema(page, subjectName, "customer_bad_evolution.avsc");

    await expect(
      page.getByLabel(
        "Conflict with prior schema version: The field 'age' at path '/fields/4' in the new schema has no default value and is missing in the old schema, source: Confluent, notification",
        { exact: true },
      ),
    ).toBeVisible();

    await evolveSchema(page, subjectName, "customer_good_evolution.avsc");

    await expect(
      page.getByText(/^New version 2 registered to existing subject "customer-.*-value"$/, {
        exact: true,
      }),
    ).toBeVisible();
  }

  test.describe("using Confluent Cloud connection", async () => {
    test.beforeEach(async ({ page, electronApp }) => {
      await login(page, electronApp, process.env.E2E_USERNAME!, process.env.E2E_PASSWORD!);
    });

    test("create a new subject and evolve it", testSchemaEvolution);
  });

  test.describe("using direct connection to Confluent Cloud Schema Registry using SR API Key", async () => {
    test.beforeEach(async ({ page, electronApp }) => {
      // Stub the dialog that tells you the connection was created
      await stubMultipleDialogs(electronApp, [
        {
          method: "showMessageBox",
          value: {
            response: 0, // Simulates clicking "OK"
            checkboxChecked: false,
          },
        },
      ]);

      await page.getByLabel("Resources Section").hover();
      await page.getByLabel("Add New Connection").click();
      await page.getByLabel("Enter manually").locator("a").click();
      const webview = page.locator("iframe").contentFrame().locator("iframe").contentFrame();

      const { apiKey, apiSecret, endpoint } = extractConfluentCredentials();

      await webview.locator("#name").click();
      await page.waitForTimeout(100);
      await page.keyboard.type("Playwright");

      await webview.locator("#formconnectiontype").click();
      await page.waitForTimeout(100);

      await webview.locator("#formconnectiontype").selectOption("Confluent Cloud");

      await webview.locator('[id="schema_registry\\.uri"]').click();
      // Wait for the input to be focused.
      await page.waitForTimeout(100);
      await page.keyboard.type(endpoint);

      await webview.locator('[id="schema_registry\\.auth_type"]').click();
      await webview.locator('[id="schema_registry\\.auth_type"]').selectOption("API");

      await webview.locator('[id="schema_registry\\.credentials\\.api_key"]').click();
      await page.waitForTimeout(100);
      await page.keyboard.type(apiKey);

      await webview.locator('[id="schema_registry\\.credentials\\.api_secret"]').click();
      await page.waitForTimeout(100);
      await page.keyboard.type(apiSecret);

      // First test
      await webview.getByRole("button", { name: "Test" }).click();
      await expect(webview.getByText("Connection test succeeded")).toBeVisible();

      await webview.getByRole("button", { name: "Save" }).click();

      // TODO: Check that connection was established successfully.
    });

    test("create a new subject and evolve it", testSchemaEvolution);
  });
});

/**
 * Extracts the API key, secret, and endpoint from the E2E_SR_API_KEY environment variable. The
 * environment variable contains the text of the downloaded API key from Confluent Cloud, which contains
 * the API key, secret, and endpoint (as well as Resource scope, Environment, and Resource, which we
 * don't need).
 * @returns { apiKey: string, apiSecret: string, endpoint: string }
 */
function extractConfluentCredentials() {
  const e2e_sr_api_key = process.env.E2E_SR_API_KEY!;
  const apiKeyMatch = e2e_sr_api_key.match(/API key:\s*([A-Z0-9]+)/)!;
  const apiSecretMatch = e2e_sr_api_key.match(/API secret:\s*([A-Za-z0-9]+)/)!;
  const endpointMatch = e2e_sr_api_key.match(/Endpoint:\s*(\S+)/)!;

  return {
    apiKey: apiKeyMatch[1],
    apiSecret: apiSecretMatch[1],
    endpoint: endpointMatch[1],
  };
}
