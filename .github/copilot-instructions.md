# Confluent VS Code Extension

This VS Code extension helps developers build stream processing applications using Confluent
technology. The extension integrates with Confluent Cloud products and Apache Kafka® compatible
clusters within VS Code.

## Architecture Overview

### Sidecar Process Pattern

- **Core concept**: Extension communicates with a separate `ide-sidecar` process that handles heavy
  operations
- **Location**: Sidecar binaries in `bin/`, managed by `src/sidecar/sidecarManager.ts`
- **Communication**: WebSocket + REST API via `SidecarHandle` - always use short-lived handles
- **Key classes**: `SidecarManager` (singleton), `SidecarHandle` (per-request), `WebsocketManager`
- **Pattern**: `await getSidecar()` → use handle → discard (enables automatic reconnection)

### View Provider Architecture

- **Tree Views**: Resources, Topics, Schemas, Flink Statements, Flink Databases - all extend
  `RefreshableTreeViewProvider`
- **Webviews**: Message viewer, connection forms, project scaffolding via HTML templates +
  TypeScript
- **Pattern**: ViewProvider manages tree state, delegates to ResourceLoader subclasses for data
  fetching and caching

### Client Code Generation

- **Never edit** `src/clients/` - all auto-generated from OpenAPI specs in
  `src/clients/sidecar-openapi-specs/`
- **To modify**: Update OpenAPI spec → run `npx gulp apigen` → commit both spec, generated code, and
  a patch to `src/clients/sidecar-openapi-specs/patches/` so subsequent generations apply cleanly
- **GraphQL**: Use `gql.tada` for type-safe queries, schema in `src/graphql/sidecar.graphql`

## Development Workflows

### Build System (Gulp-based)

```bash
# Core commands - use these, not npm scripts
npx gulp build          # Build for development
npx gulp build -w       # Watch mode
npx gulp test          # Unit tests (Mocha/Sinon)
npx gulp test -t "test name here" # Run specific test(s) by name
npx gulp e2e           # End-to-end tests (Playwright)
npx gulp check         # TypeScript type checking
npx gulp lint          # ESLint with auto-fix: gulp lint -f
```

### Pre-commit Hooks (Husky)

- **Automated checks**: Husky runs `gulp lint` before every commit to enforce code quality
- **Location**: Hook script in `.husky/pre-commit`
- **CI behavior**: Disabled in CI/CD via `HUSKY=0` environment variable to avoid duplicate checks
- **Bypass**: Use `git commit --no-verify` only in exceptional cases (not recommended)
- **Auto-fix**: Run `gulp lint -f` to automatically fix linting issues before committing

### Testing Strategy

- **Unit**: Co-located `.test.ts` files, Mocha + Sinon + assert, focus on isolated behavior
- **Functional**: Webview tests in `src/webview/*.spec.ts` using Playwright for UI validation
- **E2E**: Full workflows in `tests/e2e/` with Page Object Model pattern
- **Coverage**: Run tests with `--coverage` flag for Istanbul reports

### Extension Settings Pattern

- **Constants**: Define in `src/extensionSettings/constants.ts` as `ExtensionSetting<T>` instances
  to match `package.json`'s `contributes.configuration` sections
- **Usage**: Access via `.value` property, automatically syncs with VS Code configuration
- **Listener**: Setting changes handled by `src/extensionSettings/listener.ts`

## Key Patterns & Conventions

### Error Handling

- **Logging**: Always use `logError()` utility for consistent error capture
- **User-facing**: Use `showErrorNotificationWithButtons()` with "Open Logs" and "File Issue"
  actions
- **Messages**: Write actionable messages explaining what happened, why, and how to resolve

### Chat Participant (Copilot)

- **Registration**: Tools in `src/chat/tools/`, extend `BaseLanguageModelTool<T>`
- **Handler**: `chatHandler()` in `src/chat/participant.ts` processes requests and streams responses
- **Tools**: Auto-registered via `registerChatTools()`, support tool chaining and conversation
  context

### Resource Management

- **Loaders**: `ResourceLoader` pattern for async data fetching with caching
- **Connections**: CCloud (OAuth), Direct (custom), Local (Docker)
- **State**: Tree view state via context values like `confluent.ccloudConnectionAvailable`

### Webview Development

- **Templates**: HTML templates in `src/webview/*.html` with template variables `${var}`
- **TypeScript**: Corresponding `.ts` files handle logic, use custom elements pattern
- **Bindings**: Data binding system in `src/webview/bindings/` using Observable patterns
- **Communication**: `sendWebviewMessage()` and message handlers for extension ↔ webview
  communication

## CRITICAL REQUIREMENTS (Non-negotiable)

### 1. Disposable Resource Management - MANDATORY

- **ALL** classes that register event listeners MUST implement `vscode.Disposable`
- **ALWAYS** call `.dispose()` on resources when done - especially `.event()` listeners
- **Use** `DisposableCollection` base class to manage multiple disposables automatically
- **Pattern**: Store disposables from constructors, dispose in class `.dispose()` method
- **Example**: `this.disposables.push(vscode.workspace.onDidChangeConfiguration(...))`

### 2. Type Safety - NO EXCEPTIONS

- **NEVER** use `any` type - always provide explicit types or interfaces
- **PREFER** `enum` over string union types for constants
- **REQUIRE** JSDoc comments on all exported functions and public class methods
- **TypeScript strict mode** is enforced - code must compile without type errors

### 3. Single Responsibility Principle - ENFORCE STRICTLY

- **One class, one purpose** - if class does multiple things, split it
- **One function, one task** - keep functions small and focused
- **One file, one concept** - related functionality goes together, unrelated gets separated
- **Example**: ResourceLoader handles loading, ResourceManager handles state, TreeProvider handles
  UI

## Important Guidelines

- Never modify auto-generated code in `src/clients/` - update OpenAPI specs instead
- Use sidecar pattern correctly: short-lived handles, automatic reconnection support
- Follow established testing patterns: unit tests for logic, E2E for workflows
- Prioritize proper disposal patterns for VS Code resources to prevent memory leaks (especially for
  `.event()` listeners)
- Enforce single responsibility principle in classes and modules for maintainability

## Code Review Guidelines (GitHub PR Reviews)

When reviewing pull requests for this VS Code extension:

### Focus Areas for PR Reviews

- **Disposable Management**: Verify all event listeners are properly disposed via
  `DisposableCollection`
- **Type Safety**: Ensure no `any` types are introduced and all interfaces are properly typed
- **Single Responsibility**: Check that classes and functions maintain focused, single purposes
- **Sidecar Pattern**: Confirm proper use of short-lived `SidecarHandle` instances
- **Testing Coverage**: Validate that new functionality includes appropriate unit/E2E tests
- **Error Handling**: Ensure `logError()` and `showErrorNotificationWithButtons()` are used
  consistently

### Comment Preservation

- **Never delete existing comments** unless they contain significant errors or gaps
- Comments provide valuable context about business logic, architectural decisions, and edge cases
- If code appears self-explanatory, comments may explain _why_ rather than _what_
- When suggesting improvements, enhance comments rather than removing them

### Style Preferences (Avoid Nitpicking)

- **Import statements**: Don't require `import type { }` vs `import { }` changes - both are valid
  and TypeScript handles them correctly
- Focus reviews on substantive issues: logic, architecture, testing, and critical requirements
- Let automated tooling (ESLint, Prettier) handle formatting and style consistency

### Review Checklist

- Verify the PR description is clear and applicable checklist items are completed
- Check that any OpenAPI spec changes include corresponding patches in
  `src/clients/sidecar-openapi-specs/patches/`
- Ensure extension settings follow the `ExtensionSetting<T>` pattern
- Validate webview implementations use the established template binding patterns

## Local Development with Copilot Chat

When working with Copilot chat during development:

### Code Generation Requests

- Reference existing patterns from the codebase (ResourceLoader, ViewProvider, etc.)
- Use the #vscodeAPI tool as appropriate for VS Code API or UX guidelines
- Specify which connection type (CCloud, Direct, Local) when working with Kafka resources
- Request examples that follow the established testing patterns (Mocha/Sinon for units, Playwright
  for E2E)
- Ask for proper disposable management in any new classes or event listeners

### Refactoring Assistance

- Preserve all existing comments when refactoring code
- Maintain the established architectural patterns (sidecar communication, view providers)
- Ensure refactored code follows the three critical requirements (disposables, type safety, single
  responsibility)
- Request TypeScript interfaces for complex data structures rather than inline types
