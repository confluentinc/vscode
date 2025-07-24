# Confluent VS Code Extension Development

This VS Code extension makes it easy for developers to build stream processing applications using
Confluent technology. It provides integration with Confluent Cloud products and Apache Kafka®
compatible clusters within Visual Studio Code.

## Technology Stack

- TypeScript VS Code extension with strict type checking
- Single sidecar process manages multiple workspaces concurrently
- Integration with Confluent Cloud APIs, Apache Kafka® clusters, Schema Registry, and Flink compute
  pools
- Build system uses Gulp with TypeScript compilation
- Auto-generated OpenAPI clients from specs in `src/clients/sidecar-openapi-specs/` using
  `openapi-generator`'s `typescript-fetch` generator
- Extension provides Kafka topic management, schema evolution, and stream processing application
  development

## Code Organization and Architecture

- Use consistent directory structure for related functionality (e.g., `src/featureFlags/`,
  `src/models/`)
- File names should be descriptive and match their primary purpose
- Place test files adjacent to source files with `.test.ts` suffix
- Use ResourceLoader instances for different connection types (CCloud, Direct, Local) to load and
  cache resources
- Store state through ResourceManager with locking mechanisms to prevent race conditions
- Context values control UI state and command availability through VS Code's context system
- Auto-generated code in `src/clients/` should never be modified directly - update OpenAPI specs
  instead

## TypeScript and VS Code Extension Patterns

- Use explicit types and interfaces, never use `any` type
- Prefer `async/await` over Promise chains for better readability
- Use `Promise.all` for concurrent operations when possible
- Follow functional programming patterns where appropriate
- Use classes for encapsulating related functionality and state for better organization and
  testability
- Variable and function names should be self-documenting to reduce the need for inline comments
- Keep functions small and follow the single-responsibility principle
- Follow VS Code extension API patterns for commands, tree providers, quickpicks, and webviews
- Do not use `vscode.Disposable`, instead, use `Disposable` to manage disposables in extension code
  and test this using a detached instance via a singleton with private constructor.
- Use existing ResourceLoader and ResourceManager patterns rather than creating new data fetching
  approaches
- Use VS Code's configuration API for user settings

## Error Handling and User Experience

- Use `logError()` utility for consistent error logging with stack traces and response details
- Use `showErrorNotificationWithButtons()` for user-facing errors with "Open Logs" and "File Issue"
  buttons
- Error messages should be actionable with clear next steps for users
- Wrap async operations in try/catch blocks and handle specific error types
- Include telemetry considerations when adding new error scenarios
- Provide graceful degradation when external services are unavailable
- Use VS Code's progress API for long-running operations

## Webview Development

- Webviews use vanilla TypeScript with custom HTML templates
- Use template literal functions for HTML generation with variable substitution
- Follow message passing patterns between extension and webview contexts
- Custom elements and reactive patterns using ObservableScope
- Implement proper CSP (Content Security Policy) headers

# Testing

This VS Code extension uses the Mocha BDD interface with "sinon" and "assert" packages for unit
testing, and Playwright for functional/e2e testing.

- Use descriptive test names that explain the expected behavior with the "should" prefix
- Group related tests using `describe` blocks for better organization
- Always use a `SinonSandbox` instance when setting up stubs, spies, or fakes to ensure proper
  cleanup
- Use sinon Assert API for assertions involving stubs, spies, or fakes (e.g.,
  `sinon.assert.called(stub)` instead of `assert.equal(stub.called, true)`)
- Use `sandbox.createStubInstance(ClassNameHere)` to create `SinonStubbedInstance` for class mocking
- Leverage fixtures in the `test/unit/testResources/` directory for consistent test data
  representing models from `src/models/`
  - Create new fixture instances only when slight variations are necessary or when fixtures are
    missing
- Test files should be placed adjacent to source files with `.test.ts` suffix
- Mock/stub external dependencies and API calls in unit tests to isolate the unit of work
