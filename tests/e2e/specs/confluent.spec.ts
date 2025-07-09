import { test } from "../baseTest";
import { Tag } from "../tags";

import { openConfluentExtension } from "./utils/confluent";
import { login } from "./utils/confluentCloud";

test.describe(() => {
  test("should load the extension properly", { tag: [Tag.Smoke] }, async ({ page }) => {
    await openConfluentExtension(page);
  });

  test("sign in to confluent cloud", async ({ page, electronApp }) => {
    await openConfluentExtension(page);

    await login(page, electronApp, process.env.E2E_USERNAME!, process.env.E2E_PASSWORD!);
  });
});
