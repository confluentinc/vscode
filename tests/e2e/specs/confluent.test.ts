import { test } from "./baseTest.js";
import { loginToConfluentCloud } from "./utils/auth.js";
import { closeConfluentView, openConfluentView } from "./utils/confluent.js";

test.describe("Confluent Extension", () => {
  test("should open and close Confluent view", async ({ page }) => {
    // Wait for VS Code to be ready
    await page.waitForLoadState("domcontentloaded");

    // Open the Confluent view
    await openConfluentView(page);

    // Close the Confluent view
    await closeConfluentView(page);
  });

  test("sign in to confluent cloud", async ({ page, electronApp }) => {
    await loginToConfluentCloud(
      page,
      electronApp,
      process.env.E2E_USERNAME!,
      process.env.E2E_PASSWORD!
    );
  });
});
