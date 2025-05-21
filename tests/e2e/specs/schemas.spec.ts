import { expect } from "@playwright/test";
import { test } from "vscode-test-playwright";
import { openConfluentExtension } from "./utils/confluent";
import { login } from "./utils/confluentCloud";
import { openFixtureFile } from "./utils/flinkStatement";

test.describe("Schema related functionality", () => {
  test.beforeEach(async ({ page }) => {
    await openConfluentExtension(page);
  });

  test("should create a new subject", async ({ page, electronApp }) => {
    try {
      await login(page, electronApp, process.env.E2E_USERNAME!, process.env.E2E_PASSWORD!);

      await expect(page.getByLabel("Schemas Section")).toBeVisible();
      await page.getByLabel("Schemas Section").click();
      await page.waitForTimeout(100);

      // Visible if there are no subjects in the Schema Registry
      await expect(page.getByLabel("Select Schema Registry")).toBeVisible();
      await page.getByLabel("Select Schema Registry").click();

      // Just hit enter to select the first option, this is hoping that there
      // is a schema registry in the list, which is a prerequisite for this test.
      await page.waitForTimeout(100);
      await page.keyboard.press("Enter");

      // Open customer.avsc
      await page.waitForTimeout(100);
      await openFixtureFile(page, "customer.avsc");

      await page.getByLabel("Upload Schema to Schema Registry", { exact: true }).click();
      await page.getByPlaceholder("Select a file").fill("customer.avsc");
      await page.waitForTimeout(30);
      await page.keyboard.press("Enter");

      await page.getByText("Create new subject").click();

      // Enter the subject name
      await page.getByLabel("Schema Subject").click();
      await page.getByLabel("Schema Subject").press("ControlOrMeta+a");
      await page.getByLabel("Schema Subject").fill("customer-value");
      await page.getByLabel("Schema Subject").press("Enter");

      // Assert that a success notification is shown
      await page
        .getByText('Schema registered to new subject "customer-value"', { exact: true })
        .isVisible();

      // Click on the "View in Schema Registry" button that's in the notification
      await page.getByRole("button", { name: "View in Schema Registry" }).click();

      await page.getByLabel("Evolve Schema").click();

      // Assert that the v2-draft tab opens
      await expect(page.getByText("customer-value.v2-draft.confluent.avsc")).toBeVisible();

      // Select all text in the v2-draft tab
      await page.keyboard.press("ControlOrMeta+a");

      // Delete the text in the v2-draft tab
      await page.keyboard.press("Backspace");

    } finally {
      // Directly run the vscode command to delete the subject
      await page
        .locator("a")
        .filter({ hasText: /^customer-value$/ })
        .click({
          button: "right",
        });

      await page.waitForTimeout(200);

      // Use page.selectOption to choose "Delete Subject"
      await page.selectOption("select", {
        label: "Delete All Schemas In Subject",
      });

      await page.getByPlaceholder('Enter "hard customer-value 2').fill("hard customer-value 2");
      await page.getByPlaceholder('Enter "hard customer-value 2').press("Enter");
      await page
        .getByText("Subject customer-value and 2 schema versions hard deleted.", { exact: true })
        .click();
    }

    // await page.getByText('{ "type": "record", "name": "').click();
    // await page.getByLabel("The editor is not accessible").press("ControlOrMeta+a");
    // await page.getByLabel("The editor is not accessible").press("ControlOrMeta+a");
    // await page.locator(".visible > .slider").click();
    // await page.locator("div").filter({ hasText: /^\}$/ }).click();
    // await page.locator("div").filter({ hasText: /^\}$/ }).click();
    // await page.getByLabel("The editor is not accessible").press("ControlOrMeta+a");
    // await page.getByLabel("The editor is not accessible").fill("{");
    // await page.getByText("}").click();
    // await page.getByLabel("The editor is not accessible").fill("{\n");
    // await page.getByText("{ }").click();
    // await page.getByText("{ }").click();
    // await page.getByText("{ }").click();
    // await page.getByText("{ }").click();
    // await page.getByLabel("The editor is not accessible").press("ControlOrMeta+a");
    // await page.getByText('{ "type": "record", "name": "').click();
    // await page.getByText('{ "type": "record", "name": "').click();
    // await page.getByText('{ "type": "record", "name": "').click();
    // await page.getByText('{ "type": "record", "name": "').click();
    // await page.getByLabel("The editor is not accessible").press("ControlOrMeta+a");
    // await page.getByText('{ "type": "record", "name": "').click();
    // await page.locator("div").filter({ hasText: /^\}$/ }).click();
    // await page.getByLabel("The editor is not accessible").press("ControlOrMeta+s");
    // await page.getByText('{ "type": "record", "name": "').click();
    // await page.getByLabel("Upload Schema to Schema Registry", { exact: true }).click();
    // await page.getByPlaceholder("Select a file").press("Escape");
    // await page.getByLabel("The editor is not accessible").press("Escape");
    // await page.getByLabel("The editor is not accessible").press("Escape");

    // await page.locator('div').filter({ hasText: /^Create new subject$/ }).nth(3).click();
    // await page.getByLabel('Schema Subject').click();
    // await page.getByLabel('Schema Subject').press('ControlOrMeta+a');
    // await page.getByLabel('Schema Subject').press('ControlOrMeta+z');
    // await page.getByLabel('Schema Subject').press('ControlOrMeta+a');
    // await page.getByLabel('Schema Subject').fill('customer-value');
    // await page.getByLabel('Schema Subject').press('Enter');
    // await page.getByText('Schema registered to new subject "customer-value"', { exact: true }).click();
    // await page.getByRole('button', { name: 'View in Schema Registry' }).click();
    // await page.locator('a').filter({ hasText: 'customer-value' }).click();
    // await page.locator('a').filter({ hasText: 'customer-value' }).click();
    // await page.locator('a').filter({ hasText: 'v1' }).click();
    // await page.getByText('customer-value.100001.v1.confluent.avsc', { exact: true }).click();
    // await page.getByRole('tab', { name: 'customer-value.100001.v1.' }).getByLabel('Close (⌘W)').click();
    // await page.getByLabel('Evolve Schema').click();
    // await page.getByLabel('Evolve Schema').click();
    // await page.getByLabel('Evolve Schema').click();
    // await page.getByLabel('Evolve Schema').click();
    // await page.getByLabel('Evolve Schema').click();
    // await page.getByText('{ "type": "record", "name": "').click();
    // await page.getByRole('tab', { name: 'customer-value.v2-draft.confluent.avsc • /Users/rohitsanjay/vscode/out/tests/fixtures/schemas/customer.avsc/customer-value.v2-draft.confluent.avsc/customer-value.v2-draft.confluent.avsc/customer-value.v2-draft.confluent.avsc/customer-value.v2-draft.confluent.avsc/customer-value.v2-draft.confluent.avsc', exact: true }).locator('span').nth(2).click();
    // await page.getByRole('tab', { name: 'customer-value.v2-draft.confluent.avsc • /Users/rohitsanjay/vscode/out/tests/fixtures/schemas/customer.avsc/customer-value.v2-draft.confluent.avsc/customer-value.v2-draft.confluent.avsc/customer-value.v2-draft.confluent.avsc/customer-value.v2-draft.confluent.avsc', exact: true }).locator('span').nth(2).click();
    // await page.getByRole('tab', { name: 'customer-value.v2-draft.confluent.avsc • /Users/rohitsanjay/vscode/out/tests/fixtures/schemas/customer.avsc/customer-value.v2-draft.confluent.avsc/customer-value.v2-draft.confluent.avsc/customer-value.v2-draft.confluent.avsc', exact: true }).locator('span').nth(2).click();
    // await page.getByRole('tab', { name: 'customer-value.v2-draft.confluent.avsc • /Users/rohitsanjay/vscode/out/tests/fixtures/schemas/customer.avsc/customer-value.v2-draft.confluent.avsc/customer-value.v2-draft.confluent.avsc', exact: true }).locator('span').nth(2).click();
    // await page.getByRole('tab', { name: 'customer-value.v2-draft.confluent.avsc • /Users/rohitsanjay/vscode/out/tests/fixtures/schemas/customer.avsc/customer-value.v2-draft.confluent.avsc', exact: true }).locator('span').nth(2).click();
    // await page.getByLabel('Upload Schema to Schema Registry for Subject').click();
    // await page.getByPlaceholder('Select a file').press('Enter');
    // await page.getByLabel('AVRO', { exact: true }).locator('label').click();
    // await page.getByLabel('Conflict with prior schema version: The field \'age\' at path \'/fields/4\' in the new schema has no default value and is missing in the old schema, source: Confluent, notification, Inspect the response in the accessible view with Option+F2', { exact: true }).locator('div').filter({ hasText: 'Conflict with prior schema' }).nth(2).click();
    // await page.getByLabel('Expand Notification (→)').click();
    // await page.getByRole('code').locator('div').filter({ hasText: '"type": "int"' }).nth(4).click();
    // await page.getByLabel('The editor is not accessible').fill('defa');
    // await page.getByLabel('The editor is not accessible').press('Alt+Shift+ArrowLeft');
    // await page.getByLabel('The editor is not accessible').fill('default');
    // await page.getByLabel('The editor is not accessible').press('ArrowRight');
    // await page.getByLabel('The editor is not accessible').fill(': ');
    // await page.locator('span').filter({ hasText: '"type": "int"' }).locator('span').nth(2).click();
    // await page.getByText('"int"').click();
    // await page.getByLabel('The editor is not accessible').press('ArrowLeft');
    // await page.getByLabel('The editor is not accessible').press('ArrowLeft');
    // await page.getByLabel('The editor is not accessible').fill(' [');
    // await page.getByLabel('The editor is not accessible').press('Alt+ArrowRight');
    // await page.getByLabel('The editor is not accessible').press('ArrowLeft');
    // await page.getByLabel('The editor is not accessible').fill(', ');
    // await page.getByLabel('The editor is not accessible').press('ControlOrMeta+ArrowRight');
    // await page.getByLabel('The editor is not accessible').press('ArrowLeft');
    // await page.getByLabel('The editor is not accessible').fill('"]');
    // await page.getByLabel('The editor is not accessible').press('ArrowDown');
    // await page.getByLabel('The editor is not accessible').fill('null');
    // await page.getByLabel('The editor is not accessible').press('Escape');
    // await page.getByLabel('The editor is not accessible').press('ArrowDown');
    // await page.getByLabel('Upload Schema to Schema Registry for Subject').click();
    // await page.getByPlaceholder('Select a file').press('Enter');
    // await page.getByLabel('AVRO', { exact: true }).locator('label').click();
    // await page.getByText('New version 2 registered to existing subject "customer-value"', { exact: true }).click();
    // await page.getByRole('button', { name: 'View in Schema Registry' }).click();
    // await page.locator('a').filter({ hasText: /^v2$/ }).click();
    // await page.getByText('{ "type": "record", "name": "').click();
    // await page.locator('a').filter({ hasText: /^customer-value$/ }).click({
    //   button: 'right'
    // });
    // await page.getByLabel('Hard Delete, Any existing').locator('label').click();
    // await page.getByPlaceholder('Enter "hard customer-value 2').fill('hard customer-value 2');
    // await page.getByPlaceholder('Enter "hard customer-value 2').press('Enter');
    // await page.getByText('Subject customer-value and 2 schema versions hard deleted.', { exact: true }).click();
  });
});
