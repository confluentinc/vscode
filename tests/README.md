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

- `playwright.config.ts` file contains the configuration for the e2e tests. (Note: This is not to be
  confused with the `playwright.config.ts` file in the root of the project. The root configuration
  file is used to run the `*.spec.ts` files in the `src` directory for webview-specific testing via
  `gulp functional`.).)
- `specs` directory contains the test files.
- `specs/utils` directory contains utility functions for the tests.

> [!NOTE] What's the difference between `gulp e2e` and `gulp functional`?
>
> `gulp e2e` runs the E2E tests in the `tests/e2e/specs` directory, whereas `gulp functional` runs
> the functional tests under `src/webview/` (and its subdirectories). Both use Playwright to run the
> tests. However, the E2E tests run in a OS-native Electron window rather than just testing web
> views in a browser environment.

### Running the E2E tests

> [!IMPORTANT] Please close any already-open VS Code windows before running the tests. This is
> because the tests launch their own VS Code instance and need to properly handle browser auth
> callbacks.

We currently run the tests against Confluent Cloud production environment. We may add support for
running against other non-production environments in the future.

#### Pre-requisites

Tests that interact with a Confluent Cloud resource (e.g. submitting a Flink statement) require you
to have a `.env` file with the following environment variables:

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

Grep for `stubMultipleDialogs` to see how we use it to stub the Electron dialog windows during the
Confluent Cloud authentication flow.

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

   The test suite is not yet set up to run in Semaphore CI. Previous attempts at this were
   unsuccessful due to some issues with using a X Virtual Framebuffer (Xvfb) to run the tests in a
   headless mode.

   For anyone that looks into this, use the `DEBUG=pw:browser*` environment variable to get more
   detailed logs from the Playwright browser. And best of luck!

   Here's the error that we got when we tried to run the tests on an Linux x64 machine using
   `xvfb-run -a npx gulp e2e`:

    <details>
    <summary>Error message</summary>

   ```
     pw:browser <launching> /home/semaphore/vscode/.vscode-test/worker-0/vscode-linux-x64-1.100.2/code --inspect=0 --remote-debugging-port=0 --no-sandbox --disable-gpu-sandbox --disable-updates --disable-dev-shm-usage --disable-gpu --enable-smoke-test-driver --use-inmemory-secretstorage --skip-welcome --skip-release-notes --disable-workspace-trust --extensions-dir=/tmp/pwtest-uu44OE/extensions --user-data-dir=/tmp/pwtest-uu44OE/user-data --extensionTestsPath=/home/semaphore/vscode/tests/e2e/vscode-test-playwright/injected/index /home/semaphore/vscode/out +0ms04:06
   pw:browser <launched> pid=8470 +5ms04:06
   pw:browser [pid=8470][err] Debugger listening on ws://127.0.0.1:43213/706d2783-1e0b-43de-b5e7-af58e8147256 +93ms04:06
   pw:browser [pid=8470][err] For help, see: https://nodejs.org/en/docs/inspector +0ms04:06
   pw:browser <ws connecting> ws://127.0.0.1:43213/706d2783-1e0b-43de-b5e7-af58e8147256 +1ms04:06
   pw:browser <ws connected> ws://127.0.0.1:43213/706d2783-1e0b-43de-b5e7-af58e8147256 +4ms04:06
   pw:browser [pid=8470][err] Debugger attached. +0ms04:06
   pw:browser [pid=8470][err] error: XDG_RUNTIME_DIR is invalid or not set in the environment. +3s04:09
   pw:browser [pid=8470][err] [8470:0521/173017.138029:ERROR:bus.cc(407)] Failed to connect to the bus: Could not parse server address: Unknown address type (examples of valid types are "tcp" and on UNIX "unix") +987ms04:10
   pw:browser [pid=8470][err] [8470:0521/173017.138218:ERROR:bus.cc(407)] Failed to connect to the bus: Could not parse server address: Unknown address type (examples of valid types are "tcp" and on UNIX "unix") +0ms04:10
   pw:browser [pid=8470][err] [8470:0521/173017.138249:ERROR:bus.cc(407)] Failed to connect to the bus: Could not parse server address: Unknown address type (examples of valid types are "tcp" and on UNIX "unix") +0ms04:10
   pw:browser [pid=8470][err] [8470:0521/173017.138263:ERROR:bus.cc(407)] Failed to connect to the bus: Could not parse server address: Unknown address type (examples of valid types are "tcp" and on UNIX "unix") +1ms04:10
   pw:browser [pid=8470][err] [8470:0521/173017.138276:ERROR:object_proxy.cc(576)] Failed to call method: org.freedesktop.DBus.NameHasOwner: object_path= /org/freedesktop/DBus: unknown error type:  +0ms04:10
   pw:browser [pid=8470][err]  +51ms04:10
   pw:browser [pid=8470][err] DevTools listening on ws://127.0.0.1:46663/devtools/browser/e11c7d09-445b-42d7-b190-58eb4a4cb585 +0ms04:10
   pw:browser <ws connecting> ws://127.0.0.1:46663/devtools/browser/e11c7d09-445b-42d7-b190-58eb4a4cb585 +0ms04:10
   pw:browser <ws connected> ws://127.0.0.1:46663/devtools/browser/e11c7d09-445b-42d7-b190-58eb4a4cb585 +5ms04:10
   pw:browser [pid=8470][err] Warning: 'remote-debugging-port' is not in the list of known options, but still passed to Electron/Chromium. +31ms04:10
   pw:browser [pid=8470][out] [main 2025-05-21T17:30:17.324Z] lifecycle (main): phase changed (value: 2) +98ms04:10
   pw:browser [pid=8470][out] [main 2025-05-21T17:30:17.485Z] lifecycle (main): phase changed (value: 3) +161ms04:10
   pw:browser [pid=8470][out] [main 2025-05-21T17:30:17.493Z] update#setState disabled +8ms04:10
   pw:browser [pid=8470][out] [main 2025-05-21T17:30:17.493Z] update#ctor - updates are disabled by the environment +0ms04:10
   pw:browser [pid=8470][err] [8470:0521/173017.493903:ERROR:bus.cc(407)] Failed to connect to the bus: Could not parse server address: Unknown address type (examples of valid types are "tcp" and on UNIX "unix") +1ms04:10
   pw:browser [pid=8470][out] [main 2025-05-21T17:30:19.987Z] lifecycle (main): phase changed (value: 4) +2s04:13
   pw:browser [pid=8470][out] [main 2025-05-21T17:30:21.673Z] Lifecycle#app.on(before-quit) +2s04:14
   pw:browser [pid=8470][out] [main 2025-05-21T17:30:21.673Z] Lifecycle#onBeforeShutdown.fire() +0ms04:14
   pw:browser [pid=8470][out] [main 2025-05-21T17:30:21.674Z] Lifecycle#window.on('close') - window ID 1 +1ms04:14
   pw:browser [pid=8470][out] [main 2025-05-21T17:30:21.674Z] Lifecycle#unload() - window ID 1 +0ms04:14
   pw:browser <ws disconnecting> ws://127.0.0.1:43213/706d2783-1e0b-43de-b5e7-af58e8147256 +41ms04:14
   pw:browser [pid=8470][err] Debugger ending on ws://127.0.0.1:43213/706d2783-1e0b-43de-b5e7-af58e8147256 +0ms04:14
   pw:browser [pid=8470][err] For help, see: https://nodejs.org/en/docs/inspector +1ms04:14
   pw:browser <ws disconnected> ws://127.0.0.1:43213/706d2783-1e0b-43de-b5e7-af58e8147256 code=1005 reason= +0ms04:14
   pw:browser [pid=8470][out] [main 2025-05-21T17:30:21.728Z] Extension host with pid 9123 exited with code: 0, signal: unknown. +12ms04:14
   pw:browser [pid=8470][out] [main 2025-05-21T17:30:21.752Z] Lifecycle#onBeforeCloseWindow.fire() - window ID 1 +24ms04:14
   pw:browser [pid=8470][out] [main 2025-05-21T17:30:21.756Z] Lifecycle#window.on('closed') - window ID 1 +4ms04:14
   pw:browser [pid=8470][out] [main 2025-05-21T17:30:21.756Z] Lifecycle#onWillShutdown.fire() +0ms04:14
   pw:browser [pid=8470][out] [main 2025-05-21T17:30:21.758Z] Lifecycle#app.on(window-all-closed) +2ms04:14
   pw:browser [pid=8470][out] [main 2025-05-21T17:30:21.758Z] Lifecycle#app.on(will-quit) - begin +0ms04:14
   pw:browser [pid=8470][out] [main 2025-05-21T17:30:21.765Z] Lifecycle#app.on(will-quit) - after fireOnWillShutdown +7ms04:14
   pw:browser [pid=8470][out] [main 2025-05-21T17:30:21.765Z] Lifecycle#app.on(will-quit) - calling app.quit() +0ms04:14
   pw:browser [pid=8470] <process did exit: exitCode=0, signal=null> +34ms04:14
   pw:browser [pid=8470] starting temporary directories cleanup +1ms04:14
   pw:browser [pid=8470] finished temporary directories cleanup +2ms
   ```

    </details>

1. **Code coverage from the E2E tests**

   We've not yet explored the possibility of generating code coverage reports from the E2E tests.
   This would be useful to identify which parts of the production code are not being exercised by
   the tests.
