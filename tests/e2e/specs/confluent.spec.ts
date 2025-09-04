import { test } from "../baseTest";
import { Tag } from "../tags";
import { openConfluentExtension } from "./utils/confluent";
import { login } from "./utils/confluentCloud";

test.describe(() => {
  test("should activate the extension", { tag: [Tag.Smoke] }, async ({ page, electronApp }) => {
    await openConfluentExtension(page);
  });

  test(
    "should complete the browser-based Confluent Cloud sign-in flow",
    { tag: [Tag.CCloud] },
    async ({ page, electronApp }) => {
      await openConfluentExtension(page);

      await login(page, electronApp, process.env.E2E_USERNAME!, process.env.E2E_PASSWORD!);
    },
  );
});
