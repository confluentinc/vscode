import { expect } from "@playwright/test";
import { test } from "vscode-test-playwright";
import { openConfluentExtension } from "./utils/confluent";
import { login } from "./utils/confluentCloud";
import { openFixtureFile } from "./utils/flinkStatement";

test.describe("Schema related functionality", () => {
  test.beforeEach(async ({ page }) => {
    await openConfluentExtension(page);
  });

  test("create a new subject and evolve it", async ({ page, electronApp }) => {
    const randomValue = Math.random().toString(36).substring(2, 15);
    const subjectName = `customer-${randomValue}-value`;
    try {
      await login(page, electronApp, process.env.E2E_USERNAME!, process.env.E2E_PASSWORD!);

      await expect(page.getByLabel(/Schemas.*Section/)).toBeVisible();
      await page.getByLabel(/Schemas.*Section/).click();

      // Visible if there are no subjects in the Schema Registry
      await expect(page.getByLabel("Select Schema Registry")).toBeVisible();
      await page.getByLabel("Select Schema Registry").click();

      await expect(page.getByPlaceholder("Select a Schema Registry")).toBeVisible();
      await page.getByPlaceholder("Select a Schema Registry").click();

      // Press enter to select the first option
      await page.keyboard.press("Enter");

      // Open customer.avsc
      await openFixtureFile(page, "customer.avsc");

      await page.getByLabel(/Schemas.*Section/).hover();
      await expect(
        page.getByLabel("Upload Schema to Schema Registry", { exact: true }),
      ).toBeVisible();
      await page.getByLabel("Upload Schema to Schema Registry", { exact: true }).click();

      await page.getByPlaceholder("Select a file").click();
      await page.keyboard.type("customer.avsc");
      await page.keyboard.press("Enter");

      await page.getByText("Create new subject").click();

      // Enter the subject name
      await page.getByLabel("Schema Subject").click();
      await page.getByLabel("Schema Subject").press("ControlOrMeta+a");
      await page.getByLabel("Schema Subject").fill(subjectName);
      await page.getByLabel("Schema Subject").press("Enter");

      // Assert that a success notification is shown
      await page
        .getByText(/Schema registered to new subject customer-.*-value/, {
          exact: true,
        })
        .isVisible();

      // Click on the "View in Schema Registry" button that's in the notification
      await page.getByRole("button", { name: "View in Schema Registry" }).click();

      await page.getByLabel("Evolve Schema").click();

      // Assert that the v2-draft tab opens
      await expect(
        page.getByText(/customer-.*-value.v2-draft.confluent.avsc/, { exact: true }).first(),
      ).toBeVisible();

      // Select all text in the v2-draft tab
      await page.keyboard.press("ControlOrMeta+a");

      // Delete the text in the v2-draft tab
      await page.keyboard.press("Backspace");

      await openFixtureFile(page, "customer_bad_evolution.avsc");

      // Copy the contents of the bad evolution file
      await page.keyboard.press("ControlOrMeta+a");

      await page.keyboard.press("ControlOrMeta+c");

      // tab back into the v2-draft tab
      await page
        .getByText(/customer-.*-value.v2-draft.confluent.avsc/, { exact: true })
        .first()
        .click();
      // Paste the contents of the bad evolution file into the v2-draft tab

      await page.keyboard.press("ControlOrMeta+v");

      // Click on the Upload Schema to Schema Registry button
      await page.getByLabel(/Schemas.*Section/).hover();
      await expect(
        page.getByLabel("Upload Schema to Schema Registry", { exact: true }),
      ).toBeVisible();
      await page.getByLabel("Upload Schema to Schema Registry", { exact: true }).click();

      await page.getByPlaceholder("Select a file").click();
      await page.keyboard.type("v2-draft");
      await page.keyboard.press("Enter");

      await page.keyboard.type("AVRO");
      await page.keyboard.press("Enter");

      await page.keyboard.type(subjectName);
      await page.keyboard.press("Enter");

      // Assert that an error notification is shown
      await expect(
        page.getByLabel(
          "Conflict with prior schema version: The field 'age' at path '/fields/4' in the new schema has no default value and is missing in the old schema, source: Confluent, notification",
          { exact: true },
        ),
      ).toBeVisible();

      await page
        .getByText(/customer-.*-value.v2-draft.confluent.avsc/, { exact: true })
        .first()
        .click();
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.press("Backspace");
      await openFixtureFile(page, "customer_good_evolution.avsc");

      // Copy the contents of the good evolution file
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.press("ControlOrMeta+c");
      await page
        .getByText(/customer-.*-value.v2-draft.confluent.avsc/, { exact: true })
        .first()
        .click();
      await page.keyboard.press("ControlOrMeta+v");

      // Click on the Upload Schema to Schema Registry button
      await page.getByLabel(/Schemas.*Section/).hover();
      await expect(
        page.getByLabel("Upload Schema to Schema Registry", { exact: true }),
      ).toBeVisible();
      await page.getByLabel("Upload Schema to Schema Registry", { exact: true }).click();

      await page.getByPlaceholder("Select a file").click();
      await page.keyboard.type("v2-draft");
      await page.keyboard.press("Enter");

      await page.keyboard.type("AVRO");
      await page.keyboard.press("Enter");

      await page.keyboard.type(subjectName);
      await page.keyboard.press("Enter");

      // Assert that a success notification is shown
      await expect(
        page.getByText(/^New version 2 registered to existing subject "customer-.*-value"$/, {
          exact: true,
        }),
      ).toBeVisible();
    } finally {
      // Trigger the confluent.schemas.deleteVersion command

      await page.keyboard.press("Shift+ControlOrMeta+P");
      // Wait for the command palette to open

      await page.keyboard.type("Delete Subject");

      await page.keyboard.press("Enter");

      await expect(page.getByPlaceholder("Select existing subject")).toBeVisible();
      await page.keyboard.type(subjectName);

      await page.keyboard.press("Enter");

      await page.getByLabel("Hard Delete").click();

      // Get the validation message and extract the required text
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
        page
          .getByText(/Subject customer-.*-value and.*hard deleted./, {
            exact: true,
          })
          .first(),
      ).toBeVisible();
    }
  });
});
