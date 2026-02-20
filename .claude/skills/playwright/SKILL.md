---
name: playwright
description:
  Use when the user asks about Playwright APIs, selectors, assertions, or patterns for E2E or
  functional tests. Triggers on questions like "how to click a button in Playwright", "Playwright
  locator", "page.waitFor", "expect toBeVisible", "Playwright test fixtures", or E2E test patterns.
allowed-tools: Read, Bash, WebFetch, WebSearch
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
objects rather than writing raw locator logic in test files.

**View hierarchy:**

```
View (tests/e2e/objects/views/View.ts)
  └── SearchableView (same file)
      ├── ResourcesView    — environments, clusters, registries
      ├── TopicsView        — topics within selected Kafka cluster
      ├── SchemasView       — schemas within selected Schema Registry
      ├── FlinkDatabaseView — Flink databases and tables
      └── HelpCenterView
```

**View items** (`tests/e2e/objects/views/viewItems/`):

```
ViewItem (ViewItem.ts) — base for all tree items
  ├── CCloudConnectionItem
  ├── DirectConnectionItem
  ├── LocalConnectionItem
  ├── KafkaClusterItem
  ├── SchemaRegistryItem
  ├── TopicItem
  ├── SubjectItem
  └── FlinkComputePoolItem
```

**Webviews** (`tests/e2e/objects/webviews/`):

```
Webview (Webview.ts) — handles nested iframe access
  ├── MessageViewerWebview
  ├── ProjectScaffoldWebview
  └── DirectConnectionFormWebview
```

**Other page objects**: `ActivityBarItem`, `ViewContainer`, `FileExplorer`, `InputBox`, `Quickpick`,
`Notification`, `NotificationArea`, `TextDocument`

### Custom Fixtures (baseTest.ts)

E2E tests import `test` from `tests/e2e/baseTest.ts` (not from `@playwright/test`). This provides
custom fixtures:

| Fixture                  | Type                      | Default                    | Description                                       |
| ------------------------ | ------------------------- | -------------------------- | ------------------------------------------------- |
| `testTempDir`            | `string`                  | auto                       | Unique temp directory per test                    |
| `electronApp`            | `ElectronApplication`     | auto                       | Launched VS Code Electron instance                |
| `page`                   | `Page`                    | auto                       | Main VS Code window                               |
| `openExtensionSidebar`   | `void`                    | **auto**                   | Opens Confluent sidebar (runs for all tests)      |
| `connectionType`         | `ConnectionType`          | `undefined`                | Set via `test.use()` — required for connections   |
| `directConnectionConfig` | `DirectConnectionOptions` | env vars                   | Bootstrap servers, auth creds from env            |
| `localConnectionConfig`  | `LocalConnectionOptions`  | `{ schemaRegistry: true }` | Schema registry enabled by default                |
| `connectionItem`         | Connection item union     | auto-setup                 | Sets up connection, returns typed connection item |
| `topicConfig`            | `TopicConfig`             | `undefined`                | Set via `test.use()` — required for topics        |
| `topic`                  | `string`                  | auto-create                | Creates topic on setup, deletes on teardown       |

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

### Test Tags (tags.ts)

Tags are used instead of conditionals for filtering test dimensions (conditionals within E2E tests
violate ESLint rules). Defined in `tests/e2e/tags.ts`:

| Tag                         | Purpose                                         |
| --------------------------- | ----------------------------------------------- |
| `@smoke`                    | Fast smoke tests (extension activation, signin) |
| `@ccloud`                   | Requires Confluent Cloud connection             |
| `@direct`                   | Requires direct connection                      |
| `@local`                    | Requires local Docker Kafka/SR                  |
| `@requires-topic`           | Needs topic fixture                             |
| `@topic-message-viewer`     | Topic listing and message viewing               |
| `@produce-message-to-topic` | Message production tests                        |
| `@evolve-schema`            | Schema CRUD operations                          |
| `@project-scaffolding`      | Project template generation                     |
| `@flink-statements`         | Flink SQL statement tests                       |
| `@flink-artifacts`          | Flink artifact upload/delete                    |
| `@direct-connection-crud`   | Direct connection lifecycle                     |

Run by tag: `npx gulp e2e -t "@smoke"`

### Utility Functions (tests/e2e/utils/)

| File                   | Key Exports                                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| `connections.ts`       | `setupCCloudConnection()`, `setupDirectConnection()`, `setupLocalConnection()`, `teardownLocalConnection()` |
| `commands.ts`          | `executeVSCodeCommand()`                                                                                    |
| `settings.ts`          | `configureVSCodeSettings()`                                                                                 |
| `sidebarNavigation.ts` | `openConfluentSidebar()`                                                                                    |
| `producer.ts`          | `produceMessages()`                                                                                         |
| `documents.ts`         | `openNewUntitledDocument()`                                                                                 |
| `clipboard.ts`         | Clipboard read/write utilities                                                                              |
| `strings.ts`           | `randomHexString()`                                                                                         |
| `scaffold.ts`          | Project generation utilities                                                                                |
| `flinkStatement.ts`    | Flink SQL execution                                                                                         |
| `flinkDatabase.ts`     | Flink database operations                                                                                   |

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

## Output Format

### API Reference

```markdown
## Playwright: [method/feature]

### API

[Method signature and description from docs]

### Parameters

[Parameter table if applicable]

### Example

[Code example from docs or adapted to project patterns]

### Project Usage

[How this is typically used in the project, with file references if found]

### Electron Note (if applicable)

[Any caveats for Electron vs browser usage]
```

### Pattern Guidance

```markdown
## Pattern: [description]

### From the Docs

[Official recommended approach]

### In This Project

[How the project implements this pattern, with examples from existing tests]

### Key Points

- [Important considerations]
- [Common pitfalls to avoid]
```

## Common Lookup Patterns

### Locators

- **Role**: `page.getByRole('button', { name: 'Submit' })`
- **Text**: `page.getByText('Hello')`, `page.getByText(/pattern/)`
- **Label**: `page.getByLabel('Username')`
- **Placeholder**: `page.getByPlaceholder('Enter email')`
- **Test ID**: `page.getByTestId('submit-btn')`
- **CSS/XPath**: `page.locator('.class')`, `page.locator('xpath=...')` (last resort)
- **Filtering**: `locator.filter({ hasText: 'foo' })`, `locator.filter({ has: childLocator })`
- **Chaining**: `page.getByRole('list').getByRole('listitem')`

### Actions

- **Click**: `locator.click()`, `locator.dblclick()`, `locator.click({ button: 'right' })`
- **Type**: `locator.fill('text')`, `locator.type('text')`, `locator.press('Enter')`
- **Select**: `locator.selectOption('value')`, `locator.selectOption({ label: 'Text' })`
- **Check**: `locator.check()`, `locator.uncheck()`, `locator.setChecked(true)`
- **Hover**: `locator.hover()`
- **Upload**: `locator.setInputFiles('path/to/file')`

### Assertions

- **Visibility**: `expect(locator).toBeVisible()`, `expect(locator).toBeHidden()`
- **Text**: `expect(locator).toHaveText('text')`, `expect(locator).toContainText('partial')`
- **Value**: `expect(locator).toHaveValue('val')`, `expect(locator).toHaveAttribute('attr', 'val')`
- **State**: `expect(locator).toBeEnabled()`, `expect(locator).toBeChecked()`
- **Count**: `expect(locator).toHaveCount(3)`

### Waiting

- **Auto-wait**: Most actions auto-wait for actionability (no manual waits needed)
- **Explicit**: `locator.waitFor()`, `locator.waitFor({ state: 'hidden' })`
- **Load state**: `page.waitForLoadState('domcontentloaded')` (used in Electron startup)

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

### Dialog Stubbing (Electron-specific)

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
