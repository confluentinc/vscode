---
applyTo: "**/*.test.ts"
description: "Unit testing practices with Mocha, Sinon, and Assert"
---

# Unit Testing with Mocha, Sinon, and Assert

Tests should be run with `npx gulp test`. When writing unit tests for this extension:

## Test Structure and Naming

- Write descriptive test names with the "should" prefix that clearly explain the expected behavior
- Group related tests using `describe` blocks for better organization and readability
- Place test files adjacent to source files with the `.test.ts` suffix

## Mocking and Stubbing

- When dealing with Sinon stubs/mocks/fakes, always create a `SinonSandbox` instance in the
  `beforeEach` hook to ensure proper teardown and isolation between tests
- Use `sandbox.createStubInstance(Class)` to create typed `SinonStubbedInstance` for class mocking
- Use the Sinon Assert API for verifying stub/spy behavior:
  ```typescript
  sinon.assert.calledWith(myStub, expectedArg); // Instead of assert.equal(myStub.calledWith(expectedArg), true)
  ```
- Mock all external dependencies including VS Code APIs and network requests

## Test Data

- Use fixtures from `test/unit/testResources/` for reusable test data representing `src/models/`
  entities
- Only create new fixture instances when necessary variations are needed
- When modifying fixtures, document the reasons for the variations

## Testing Best Practices

- Test the public API of modules, not implementation details
- Focus on testing behavior, not implementation
- Write independent tests that don't rely on each other's state, refactoring modules to separate
  concerns and help stubbing when necessary
- Verify edge cases and error handling paths
