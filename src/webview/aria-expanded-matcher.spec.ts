// Coverage for the shared `toBeExpanded()` matcher defined in tests/e2e/matchers.ts. It lives here,
// not in Electron E2E, because the rollwright functional harness is the only non-Electron way to run
// real-DOM Playwright assertions, keeping the `.not` and absent-attribute edge cases fast in CI.
import { expect } from "@playwright/test";
// registers the `toBeExpanded` matcher on Playwright's shared `expect`
import "../../tests/e2e/matchers";
import { test } from "./baseTest";

// minimal tree items covering the three aria-expanded states the matcher distinguishes
const TREE_ITEMS = `
  <div role="treeitem" data-testid="expanded" aria-expanded="true">expanded</div>
  <div role="treeitem" data-testid="collapsed" aria-expanded="false">collapsed</div>
  <div role="treeitem" data-testid="leaf">leaf</div>
`;

test.use({ coverage: false });

test.beforeEach(async ({ page }) => {
  await page.setContent(TREE_ITEMS);
});

test('toBeExpanded() passes for aria-expanded="true"', async ({ page }) => {
  await expect(page.getByTestId("expanded")).toBeExpanded();
});

test('not.toBeExpanded() passes for aria-expanded="false"', async ({ page }) => {
  await expect(page.getByTestId("collapsed")).not.toBeExpanded();
});

test("not.toBeExpanded() passes when aria-expanded is absent", async ({ page }) => {
  await expect(page.getByTestId("leaf")).not.toBeExpanded();
});
