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
- Keep track of and handle `vscode.Disposable` resources properly to avoid memory leaks
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


# Event Handling

- We use the `vscode.EventEmitter` class for event handling in the extension, with toplevel event
  emitters and associated event types defined in `src/emitters.ts`.
- Classes with event handlers must declare distinct methods for each event type they handle, and register the `.bind(this)` of each handler method to the corresponding event emitter within a `setEventHandlers()` method, which returns the array of disposables for the event handlers.
- Classes with event handlers must implement the `vscode.Disposable` interface, and should directly or indirectly have a  `dispose()` method to unregister all event handlers when the object is no longer needed. When possible, use base class `DisposableCollection` to manage the collection of disposables and to implement the `dispose()` method.

# Testing

This VS Code extension uses the Mocha BDD interface with "sinon" and "assert" packages for unit
testing, and Playwright for functional/e2e testing.

- Use descriptive test names that explain the expected behavior with the "should" prefix
- Group related tests using `describe` blocks for better organization. Toplevel `describe` blocks
  should represent the feature or module being tested, and include the let for the sinon sandbox to use for the entire file's tests, and include the beforeEach and afterEach hooks
  to set up and tear down the sandbox. Individual describe blocks for each method tested, then with one or more `it` blocks for each test case.
- Use `beforeEach` and `afterEach` hooks to set up and tear down test
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
- Tests over event handling must avoid calling the event's `fire` method directly to avoid unstubbed side-effects from unrelated registered handlers.  Instead, test individual event handler methods directly, and use the emitter stubbing fixture `test/stubs/emitters.ts::eventEmitterStubs()` to stub all event emitters to then prove that the proper event handlers are registered for the proper events.
- afterEach for tests which cause the creation of objects which register event handlers should call the `dispose` method on the object in afterEach() to ensure that all event handlers are unregistered, so that when separate tests run there will not be unintended side-effects.