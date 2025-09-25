---
applyTo: "tests/e2e/**,src/webviews/**.spec.ts"
description: "End-to-end testing with Playwright"
---

# E2E Testing with Playwright

E2E tests should be run with `npx gulp e2e`. Webview tests should be run with `npx gulp functional`.
When developing end-to-end tests for this VS Code extension:

## Test Organization

- Functional webview tests go in `src/webviews/**.spec.ts`
- Full E2E tests go in `tests/e2e/specs/**.spec.ts`
- Consult `eslint.config.mjs` for linting rules specific to Playwright tests

## Page Object Models

- Use the Page Object Model (POM) pattern to encapsulate UI interactions:
  - All POM classes go in `tests/e2e/objects/`
  - POMs should only handle UI interactions and should not include `expect`s or assertions
  - Properly type all UI element selectors and interaction methods

## Test Structure

- Write tests to validate complete user workflows
- Include proper setup and teardown for test environments
- Create isolated tests that can run independently
- Add meaningful comments explaining the user scenario being tested

## Testing Best Practices

- Focus tests on user-facing functionality rather than implementation details
- Use descriptive test names that explain the user scenario
- Include proper waiting mechanisms for UI elements and async operations
- Add retry logic where appropriate for potentially flaky UI operations
