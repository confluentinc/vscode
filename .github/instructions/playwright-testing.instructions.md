---
applyTo: "tests/e2e/**,src/webviews/**.spec.ts"
description: "End-to-end testing with Playwright"
---

# E2E Testing with Playwright

E2E tests should be run with `npx gulp e2e`. Functional webview tests should be run with
`npx gulp functional`.

## Test Organization

- **Functional**: Webview tests in `src/webview/*.spec.ts` using Playwright for UI validation
- **E2E**: Full workflows in `tests/e2e/` with Page Object Model pattern
- **Coverage**: Run tests with `--coverage` flag for Istanbul reports
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
