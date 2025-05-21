import { test } from "vscode-test-playwright";

import { openConfluentExtension } from "./utils/confluent";
import { login } from "./utils/confluentCloud";

test.describe(() => {
  test("should load the extension properly", async ({ page }) => {
    await openConfluentExtension(page);
  });

  test("sign in to confluent cloud", async ({ page, electronApp }) => {
    await login(page, electronApp, process.env.E2E_USERNAME!, process.env.E2E_PASSWORD!);
  });
});
