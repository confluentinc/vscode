---
paths:
  - tests/e2e/**/*
---

# End-to-End Tests (Playwright + Electron)

## Framework & Location

- Full workflow tests in `tests/e2e/` using Playwright + Electron
- Run with `npx gulp e2e` or `npx gulp e2e -t "test name"`
- Located in separate directory from source code

## Requirements

- Docker must be running for local Kafka/SR instances
- Extension Development Host launched via Playwright's `electron.launch()` API

## Key Patterns

- **Page Object Model**: page objects in `tests/e2e/pages/` abstract UI interactions
- **No conditionals in tests**: do not include conditionals within E2E tests to manage test
  dimensions — this violates ESLint rules. Instead, use test tags and filtering at runtime.
- Test files should exercise complete user workflows, not isolated units
