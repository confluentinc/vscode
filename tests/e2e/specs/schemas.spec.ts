import { Page, expect } from "@playwright/test";
import { test } from "vscode-test-playwright";
import { openConfluentExtension } from "./utils/confluent";
import { login } from "./utils/confluentCloud";
import { openFixtureFile } from "./utils/flinkStatement";

async function createNewSubject(page: any, subjectName: string, schemaFile: string) {
  await page.getByLabel(/Schemas.*Section/).click();
  await page.getByLabel("Select Schema Registry").click();
  await page.getByPlaceholder("Select a Schema Registry").click();
  await page.keyboard.press("Enter");

  await openFixtureFile(page, schemaFile);

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

  await page.getByText(/Schema registered to new subject.*/, { exact: true }).isVisible();
  await page.getByRole("button", { name: "View in Schema Registry" }).click();
}

async function evolveSchema(page: Page, subjectName: string, fixtureFile: string) {
  await page.getByLabel(subjectName).first().hover({ timeout: 200 });
  await page.getByRole("button", { name: "Evolve Latest Schema" }).click();
  await expect(page.getByText(/.*draft.confluent.avsc/, { exact: true }).first()).toBeVisible();
  await page
    .getByText(/.*draft.confluent.avsc/, { exact: true })
    .first()
    .click();

  await openFixtureFile(page, fixtureFile);
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+c");

  await page
    .getByText(/.*draft.confluent.avsc/, { exact: true })
    .first()
    .click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("ControlOrMeta+v");

  await uploadSchema(page, subjectName, "draft");
}

async function uploadSchema(page: any, subjectName: string, fileBufferTitle: string) {
  await page.getByLabel(/Schemas.*Section/).hover();
  await expect(page.getByLabel("Upload Schema to Schema Registry", { exact: true })).toBeVisible();
  await page.getByLabel("Upload Schema to Schema Registry", { exact: true }).click();

  await page.getByPlaceholder("Select a file").click();
  await page.keyboard.type(fileBufferTitle);
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

  test("create a new subject and evolve it", async ({ page, electronApp }) => {
    const randomValue = Math.random().toString(36).substring(2, 15);
    subjectName = `customer-${randomValue}-value`;

    await login(page, electronApp, process.env.E2E_USERNAME!, process.env.E2E_PASSWORD!);
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
  });
});
