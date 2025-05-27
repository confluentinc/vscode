# VS Code Extension Tests

## Folder structure

- `unit` directory contains the a few utility functions that are used by the unit tests co-located
  with the production code in the [`src/`](../src) directory.
- `stubs` directory contains the stubs for the production code that are used by the unit tests.
- `e2e` as the name suggests, contains the end-to-end (E2E) tests.
- `fixtures` directory contains the fixtures for all tests. Use the `loadFixture` function in
  [`fixtures/utils.ts`](fixtures/utils.ts) to read a particular fixture file.

## E2E Tests using Playwright

The E2E tests use [Playwright with Electron](https://playwright.dev/docs/api/class-electron) to
launch VS Code and interact with it programmatically.

### E2E Folder structure

- `playwright.config.ts` file contains the configuration for the E2E tests. (Note: This is not to be
  confused with the `playwright.config.ts` file in the root of the project. The root configuration
  file is used to run the `*.spec.ts` files in the `src` directory for webview-specific testing via
  `gulp functional`.).)
- `specs` directory contains the test files.
- `specs/utils` directory contains utility functions for the tests.

> [!NOTE] 
> What's the difference between `gulp e2e` and `gulp functional`?
>
> `gulp e2e` runs the E2E tests in the `tests/e2e/specs` directory, whereas `gulp functional` runs
> the functional tests under `src/webview/` (and its subdirectories). Both use Playwright to run the
> tests. However, the E2E tests run in a OS-native Electron window rather than just testing web
> views in a browser environment.

### Running the E2E tests

> [!IMPORTANT] 
> Please close any already-open VS Code windows before running the tests. This is
> because the tests launch their own VS Code instance and need to properly handle browser auth
> callbacks.

We currently run the tests against Confluent Cloud production environment. We may add support for
running against other non-production environments in the future.

#### Prerequisites

First, we'll need to install the dependencies:

```bash
make install-dependencies
```

Next, we'll need a `.env` file with the following environment variables:

- `E2E_USERNAME`: Confluent Cloud username
- `E2E_PASSWORD`: Confluent Cloud password
- `E2E_SR_API_KEY`: Confluent Cloud API key text for accessing a particular Schema Registry server

If you're a Confluent engineer, you can run the following commands to set this up:

```bash
vault login -method=oidc -path=okta
make setup-test-env
```

#### Running all tests

As simple as:

```bash
gulp e2e
```

#### Running a specific test

To run a specific test, use the `-t` flag:

```bash
gulp e2e -t <test-name>
# For example, to run the test for submitting a Flink statement with a SELECT query:
gulp e2e -t "should submit Flink statement - SELECT"
```

#### Running the tests using a specific VS Code version

If you wanted to run the tests in a specific VS Code version, you can set the `VSCODE_VERSION`
environment variable:

```bash
VSCODE_VERSION=1.93.2 gulp e2e
```

### Debugging the E2E tests

Please refer to the [Playwright - Debugging Tests](https://playwright.dev/docs/debug) documentation
for a detailed guide on debugging Playwright tests.

To debug a particular test, set the `PWDEBUG` environment variable to `1` and run the test:

```bash
PWDEBUG=1 gulp e2e -t <test-name>
```

This will launch the test in debug mode, and you can use the Playwright inspector to debug the test.
The Playwright inspector is extremely useful to pick locators in the VS Code window to use in the
tests.

### Writing E2E tests

#### Getting familiar with the libraries we use

1. [`vscode-test-playwright`](https://github.com/ruifigueira/vscode-test-playwright/) -- the main
   library we use to run the Playwright tests in a VS Code Electron instance.

   Here are some of the key features that the library provides (taken from its README):

   - Enables direct interaction with VSCode UI elements using Playwright selectors.
   - Allows programmatic interaction with VSCode APIs to simulate user actions or access internal
     state.
   - Captures detailed information about test execution, including screenshots, network requests,
     and console logs.

   See
   [here](https://github.com/ruifigueira/vscode-test-playwright/blob/48b0eeb60c9e6bec3b77df032707155daffa8d74/src/index.ts#L24-L31)
   for the list of test fixtures offered by the library.

1. [`electron-playwright-helpers`](https://github.com/spaceagetv/electron-playwright-helpers?tab=readme-ov-file#functions)
   -- like the name suggests, it offers useful helpers to stub the Electron dialog windows among
   other utilities.

   Grep for `stubMultipleDialogs` to see how we use it to stub the Electron dialog windows during
   the Confluent Cloud authentication flow.

#### Process for writing new tests

This section outlines our current approach to writing E2E tests. As our testing practices evolve,
this guide will be updated accordingly.

To create a new E2E test:

1. Review existing tests in `tests/e2e/specs` for similar functionality. If none exist, create a new
   test file named `<feature-name>.spec.ts`.

1. Use this basic test structure as a starting point:

   ```typescript
   import { test } from "vscode-test-playwright";
   import { openConfluentExtension } from "./utils/confluent";
   import { expect } from "@playwright/test";

   test.describe("<feature-name>", () => {
     test.beforeEach(async ({ page }) => {
       // This is a helper function that opens the extension in the VS Code window.
       await openConfluentExtension(page);
     });

     test("should do something", async ({ page, electronApp }) => {
       // Write the test code here, use the `page` object to
       // interact with the VS Code window.

       // Use the `expect` function to assert any expected behavior.
       await expect(true).toBe(true);
     });
   });
   ```

1. You'll need to figure out the UI locators to use in the test. For this, start debugging the test
   you just created and then click the "Record" button in the Playwright inspector. This will record
   the actions you perform in the VS Code window and generate the locators for you. This even works
   for Webview iframes!

   ```bash
   PWDEBUG=1 gulp e2e -t <test-name>
   ```

1. That's it. You can now start writing the test using the generated locators.

#### Tips for writing tests

1. If you're testing a Webview iframe, **make sure to set the `data-testid` attribute** on the
   elements you're testing. This makes it _much_ easier to locate the elements from your test code.
1. **The [`tests`](https://github.com/ruifigueira/vscode-test-playwright/tree/main/tests) directory
   in the vscode-test-playwright repository is a good reference** if you're looking for examples of
   how to use the library. For instance, here's a
   [test](https://github.com/ruifigueira/vscode-test-playwright/blob/main/tests/integration.spec.ts#L11-L18)
   that demonstrates testing Webview iframes in the Electron window. This proved mighty useful for
   testing the [Flink Statement Results Viewer](./e2e/specs/flinkStatement.spec.ts#L58) which is
   implemented as a Webview iframe.
1. If you haven't changed anything in the production code in the `src` directory, you don't have to
   bundle a new VSIX each time while iterating on the tests. **Use `gulp e2eRun` in place of
   `gulp e2e` to run the tests to bypass the bundling step.**

#### Gotchas encountered while developing and debugging tests

Here are some gotchas that we've encountered while developing and debugging the tests:

1. **Brace yourself for a lot of flakiness.**

   To illustrate from a particular example, we've found that the VS Code Command Palette disappears
   when focus shifts to another UI element. For example, consider a test that expands a subject in
   the Schemas view, then opens the Command Palette and starts typing. If the subject's schemas
   finish loading during this sequence, it can steal focus from the Command Palette, causing it to
   close unexpectedly. Any remaining keystrokes would then be sent to a different UI element, like
   an open editor.

   In most cases, you wouldn't be able to predict exactly what sequence of actions will cause
   flakiness, so you'll have to be patient and debug the root cause using the
   [Playwright Trace Viewer](https://playwright.dev/docs/trace-viewer), Then, once you've narrowed
   down a potential root cause, add sufficient guardrails (or worst case, time delays) to ensure the
   flakiness goes away. In the example mentioned above, a deterministic fix would be to wait (using
   `await expect(<locator>).toBeVisible();`) for the subject schemas to be listed before proceeding
   to open the Command Palette.

1. If you're using `page.getByText` (or similar `getBy*` APIs) to locate an element, you may (almost
   always) run into cases where it's going to match multiple elements. In most cases, the first
   element is what you want, so you can use the `first` modifier to get the first element.

   ```typescript
   await page.getByText("Hello").first();
   ```

### Future improvements and areas for exploration

Here are some areas that we've yet to explore and that we may explore in the future:

1. **Running the tests in Semaphore CI**

   The test suite is not yet set up to run in Semaphore CI. Take a look at
   [this PR](https://github.com/confluentinc/vscode/pull/1885) for a previous attempt at this.

1. **Code coverage from the E2E tests**

   We've not yet explored the possibility of generating code coverage reports from the E2E tests.
   This would be useful to identify which parts of the production code are not being exercised by
   the tests.
