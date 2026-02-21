---
name: playwright
description:
  Use when the user asks about Playwright APIs, selectors, assertions, or patterns for E2E or
  functional tests. Triggers on questions like "how to click a button in Playwright", "Playwright
  locator", "page.waitFor", "expect toBeVisible", "Playwright test fixtures", or E2E test patterns.
allowed-tools: Read, Bash, Glob, Grep, WebFetch, WebSearch
---

# Playwright Documentation Lookup

This skill helps look up Playwright APIs, patterns, and best practices for writing E2E and
functional (webview) tests in this project.

## Important: Electron Context

This project runs Playwright against **Electron (VS Code)**, not a browser. This fundamentally
changes how many standard Playwright patterns apply:

- **No URL navigation**: `page.goto()` doesn't apply — you interact with VS Code's DOM directly
- **No `browser.newPage()`**: The page comes from `electronApp.firstWindow()`, not a browser context
- **Dialog stubbing required**: Native OS dialogs can't be interacted with — use
  `electron-playwright-helpers` (`stubAllDialogs`, `stubMultipleDialogs`) instead
- **Webview iframe nesting**: Webview content lives inside double-nested iframes — the `Webview`
  page object abstracts this as `.contentFrame().locator("iframe").contentFrame()`
- **Single worker only**: Tests share a sidecar port and **cannot parallelize**
- **Context menus**: Require VS Code setting `"window.menuStyle": "custom"` since Playwright can't
  interact with OS-native menus

Standard Playwright best practices for **test writing** still apply: Page Object Model, fixtures,
utility functions, resilient locators, auto-waiting, and avoiding `waitForTimeout()`. Just be aware
that browser-specific APIs (navigation, multiple tabs, browser contexts) often don't translate to
Electron.

## Project Test Architecture

### Two Test Levels

| Level          | Location                    | Context                                | Run Command           |
| -------------- | --------------------------- | -------------------------------------- | --------------------- |
| **E2E**        | `tests/e2e/specs/*.spec.ts` | Full Electron (VS Code) launch         | `npx gulp e2e`        |
| **Functional** | `src/webview/*.spec.ts`     | Headless browser (no Electron/VS Code) | `npx gulp functional` |

**E2E tests** launch VS Code as an Electron app and interact with the full extension. The Electron
context section above applies here — browser-specific Playwright APIs often don't translate.

**Functional tests** render VS Code webview HTML templates in a headless browser using `rollwright`
(Rollup + Playwright). They test webview UI logic — form validation, data bindings, custom elements
— **in isolation**, without launching VS Code or the extension. Standard Playwright browser APIs
apply here since the test context is a real browser page. Each spec reads its HTML template from
`src/webview/*.html`, bundles the associated TypeScript via Rollup plugins, and renders the result.
Functional tests have their own `src/webview/baseTest.ts` (extending rollwright's test base with
coverage config) — not the E2E `baseTest.ts`.

### Page Object Model (POM)

All E2E tests use page objects under `tests/e2e/objects/`. Always extend or reuse existing page
objects rather than writing raw locator logic in test files. Browse the directory to discover
available page objects — key subdirectories are `views/`, `views/viewItems/`, `webviews/`,
`quickInputs/`, `notifications/`, and `editor/`.

### Custom Fixtures (baseTest.ts)

E2E tests import `test` from `tests/e2e/baseTest.ts` (not from `@playwright/test`). This provides
custom fixtures for Electron app launch, connection setup/teardown, topic lifecycle, and more. Read
the file for available fixtures and their types.

Usage pattern:

```typescript
import { test } from "../baseTest";
import { ConnectionType } from "../types/connection";

test.use({ connectionType: ConnectionType.Ccloud });
test.use({ topicConfig: { name: "my-test-topic" } });

test("my test", async ({ page, connectionItem, topic }) => {
  // connectionItem and topic are automatically set up and torn down
});
```

### Test Tags

Tags are used instead of conditionals for filtering test dimensions. See `tests/e2e/tags.ts` for
available tags. Run by tag: `npx gulp e2e -t "@smoke"`

### Utility Functions

Reuse utility functions from `tests/e2e/utils/` for common operations (connection setup, VS Code
commands, settings, sidebar navigation, message production, etc.). Browse the directory before
writing new helpers.

## Sources

### Playwright Documentation

The official Playwright docs at `https://playwright.dev/`:

| Section            | Entry Point                | Use For                                |
| ------------------ | -------------------------- | -------------------------------------- |
| Writing Tests      | `/docs/writing-tests`      | Test structure, actions, assertions    |
| Actions            | `/docs/input`              | Clicking, typing, selecting, uploading |
| Assertions         | `/docs/test-assertions`    | `expect` API, auto-retrying assertions |
| Locators           | `/docs/locators`           | Finding elements, selector strategies  |
| Page Object Model  | `/docs/pom`                | Page class pattern (used in E2E tests) |
| Auto-waiting       | `/docs/actionability`      | How Playwright waits for elements      |
| Test Fixtures      | `/docs/test-fixtures`      | Shared setup, custom fixtures          |
| Test Configuration | `/docs/test-configuration` | `playwright.config.ts` options         |
| Parallelism        | `/docs/test-parallel`      | Parallel vs serial test execution      |
| Timeouts           | `/docs/test-timeouts`      | Test, action, navigation timeouts      |
| Best Practices     | `/docs/best-practices`     | Official recommended patterns          |
| Electron           | `/docs/api/class-electron` | Electron-specific API (launch, etc.)   |

### API Reference

Key class references for detailed method signatures:

| Class               | URL                                 | Use For                                 |
| ------------------- | ----------------------------------- | --------------------------------------- |
| ElectronApplication | `/docs/api/class-electron`          | Electron app launch, window access      |
| Page                | `/docs/api/class-page`              | Window interaction, evaluation          |
| Locator             | `/docs/api/class-locator`           | Element interaction and querying        |
| Expect (assertions) | `/docs/api/class-locatorassertions` | `toBeVisible`, `toHaveText`, etc.       |
| FrameLocator        | `/docs/api/class-framelocator`      | iframe interaction (webview nesting)    |
| Test                | `/docs/api/class-test`              | `test()`, `test.describe()`, hooks      |
| TestInfo            | `/docs/api/class-testinfo`          | Test metadata, annotations, attachments |

All URLs are relative to `https://playwright.dev`.

## Process

### 1. Understand the Question Context

Determine whether the user needs:

- **API reference**: Exact method signatures, options, return values
- **Selector help**: How to locate elements in VS Code's DOM
- **Test patterns**: Structuring tests, using fixtures, extending page objects
- **Troubleshooting**: Flaky tests, timing issues, Electron-specific problems
- **Best practices**: Official and project-specific conventions

### 2. Check Project Conventions First

Before fetching external docs, review the project's testing conventions.

**For E2E tests** (`tests/e2e/`):

- Import `test` from `../baseTest` (not `@playwright/test`) to get custom fixtures
- Use Page Object Model — extend existing page objects in `tests/e2e/objects/`
- Use `test.use()` for parameterized tests (connectionType, topicConfig)
- Use test tags from `tests/e2e/tags.ts` — no conditionals within tests
- Use utility functions from `tests/e2e/utils/` for common operations
- Run with `npx gulp e2e` or `npx gulp e2e -t "test name"`

**For functional tests** (`src/webview/*.spec.ts`):

- Import `test` from `src/webview/baseTest` (extends rollwright, not the E2E baseTest)
- Standard headless browser context — no Electron, no VS Code runtime
- Tests render VS Code webview HTML templates in isolation via Rollup plugins
- Standard Playwright browser APIs apply (locators, assertions, page interaction)
- Run with `npx gulp functional`

### 3. Fetch Documentation

**For API questions**, fetch the relevant class or guide page:

```
WebFetch: https://playwright.dev/docs/api/class-locator
Prompt: "Find the API documentation for [specific method like locator.click, locator.fill, etc.]"
```

**For Electron-specific questions**, start with the Electron API page:

```
WebFetch: https://playwright.dev/docs/api/class-electron
Prompt: "Find the Electron API documentation for [launch options, window access, etc.]"
```

**For pattern/guide questions**, fetch the relevant guide page:

```
WebFetch: https://playwright.dev/docs/best-practices
Prompt: "Find the best practices for [specific topic like selectors, waiting, etc.]"
```

**Navigation strategy:**

1. Start with the most relevant guide or API page
2. Look for links to related content in the fetched page
3. Fetch additional pages as needed for complete answers
4. Prefer guide pages for "how to" questions, API pages for "what does X do" questions

**For newer features or migration questions**, supplement with a web search:

```
WebSearch: "playwright locator filter hasText example"
WebSearch: "playwright electron launch VS Code extension test"
```

### 4. Look at Existing Test Examples

When the user needs pattern guidance, look at how the project uses Playwright:

```
# E2E test files
Glob: tests/e2e/specs/*.spec.ts

# Functional test files
Glob: src/webview/**/*.spec.ts

# Page Object Model classes
Glob: tests/e2e/objects/**/*.ts

# Utility functions
Glob: tests/e2e/utils/*.ts
```

Read relevant test files to show project-specific patterns alongside official docs.

### 5. Search for Specific APIs

When the user asks about a specific API (e.g., `locator.click()`, `expect().toBeVisible()`):

1. Fetch the relevant API class page
2. Search for the specific method or property
3. Extract the API signature with description, parameters, and examples
4. Cross-reference with project usage if applicable
5. Note any Electron-specific caveats if the API behaves differently outside a browser

When answering, include the API signature, a code example adapted to project patterns, and any
Electron-specific caveats.

## Electron-Specific Patterns

### Webview Iframe Access

VS Code webviews are double-nested iframes. The `Webview` page object handles this:

```typescript
// in Webview base class:
get webview() {
  return this.locator.contentFrame().locator("iframe").contentFrame();
}
// then access content inside the webview:
this.webview.locator(".my-element");
```

### Dialog Stubbing

```typescript
import { stubAllDialogs, stubMultipleDialogs } from "electron-playwright-helpers";

// stub all dialogs (done by default in electronApp fixture)
await stubAllDialogs(electronApp);

// stub specific dialogs with custom return values
await stubMultipleDialogs(electronApp, [
  { method: "showSaveDialog", value: { filePath: "/tmp/file.txt" } },
  { method: "showOpenDialog", value: { filePaths: ["/tmp/dir"] } },
  { method: "showMessageBox", value: { response: 0 } },
]);
```

## Tips

- **Always check project page objects first** — most VS Code UI elements already have page objects.
  Extend existing classes rather than duplicating locator logic in tests
- **Import `test` from `baseTest`** — not from `@playwright/test` — to get the custom Electron
  fixtures (electronApp, page, connectionItem, topic, etc.)
- **Use `test.use()` for parameterization** — set `connectionType` and `topicConfig` per `describe`
  block rather than using conditionals, which violate ESLint rules
- **Prefer `getByRole`, `getByText`, `getByLabel`** over CSS selectors — they're more resilient and
  accessible. CSS selectors are acceptable for VS Code's internal DOM structure (e.g.,
  `.monaco-workbench`, `[role="treeitem"]`) where semantic selectors aren't available
- **Playwright auto-waiting handles most timing** — discourage explicit `waitForTimeout()` as it
  creates flaky tests. Use `expect().toBeVisible()` or `locator.waitFor()` instead
- **Webview content requires iframe traversal** — use the `Webview` base class's `.webview` getter
  to access content inside webview panels
- **Dialog stubbing is automatic** — the `electronApp` fixture calls `stubAllDialogs()` by default.
  Override with `stubDialog()` or `stubMultipleDialogs()` for specific return values
- **Context menus need custom menu style** — Playwright can't interact with OS-native context menus.
  The project sets `"window.menuStyle": "custom"` via `configureVSCodeSettings()` before using
  `rightClickContextMenuAction()`
- **Traces are collected on failure** — the `electronApp` fixture automatically captures and
  attaches Playwright traces for failed tests. No manual trace setup needed in test code
- Playwright docs are well-organized by topic — fetch the specific guide or API class page rather
  than broad searches
