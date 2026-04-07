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

## Stubbing Non-Public Methods

Sinon's `sandbox.stub(obj, "method")` only accepts public member names (`keyof T` excludes
`protected`/`private` members), so it cannot stub non-public methods directly. Use bracket notation
assignment instead: `obj["methodName"] = sandbox.stub()`.

- Bracket notation bypasses TypeScript's access modifier checks for keyword-declared
  `protected`/`private` members (not ES `#private` fields)
- Never use `as never` or `as any` to bypass access modifiers - bracket notation is type-aware and
  only bypasses visibility, while `as never` suppresses all type checking
- Direct assignment is not sandbox-managed, so `sandbox.restore()` won't undo it - ensure the object
  is re-created or re-assigned in `beforeEach` to prevent stubs from leaking across tests
- If the variable's declared type doesn't include the member, narrow it to the concrete subclass
  (e.g. `LocalResourceLoader` instead of `ResourceLoader`)

## Test Data

- Unit test fixtures in `tests/fixtures/`
- Shared stubs in `tests/stubs/`
