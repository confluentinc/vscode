---
paths:
  - src/**/*.test.ts
  - tests/unit/**/*
  - tests/stubs/**/*
  - tests/fixtures/**/*
---

# Unit Testing (Mocha + Sinon)

## Framework & Location

- Co-located `.test.ts` files using Mocha + Sinon + `assert`
- Run with `npx gulp test` or `npx gulp test -t "test name"` for specific tests
- Coverage: `npx gulp test --coverage`

## Key Patterns

- Use `.only` for focused testing during development (remove before PR!)
- Focus on isolated behavior, mocking external dependencies
- Do not test side effects like logging
- Set up common stubs in the top-level `describe` block so they apply to all tests

## Design for Stubbing

When writing new functions, avoid calling other functions in the same module that you'll need to
stub — Sinon can only stub **module exports**, not internal calls within the same file.

**Solutions:**

- Extract dependencies to separate modules
- Pass dependencies as parameters
- Use dependency injection patterns

## Test Data

- Unit test fixtures in `tests/fixtures/`
- Shared stubs in `tests/stubs/`
