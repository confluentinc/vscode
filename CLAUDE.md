# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this
repository.

## Project Overview

This is the **Confluent for VS Code** extension - a VS Code extension for building stream processing
applications using Confluent Cloud, Apache Kafka, and Apache Flink. The extension integrates with
Confluent Cloud products and Apache Kafka-compatible clusters within VS Code.

## Core Commands

### Build & Development

```bash
npx gulp build          # Development build (same as "Build for development")
npx gulp build -w       # Watch mode
npx gulp check          # TypeScript type checking
npx gulp lint           # ESLint (add -f for auto-fix)
```

### Testing

```bash
npx gulp test                         # Unit tests (Mocha/Sinon)
npx gulp test -t "test name"          # Run specific test(s) by name
npx gulp functional                   # Webview tests (Playwright) - same as functional tests
npx gulp e2e                          # End-to-end tests (Playwright)
npx gulp e2e -t "test name"           # Run specific end-to-end tests by name
npx gulp test --coverage              # Generate Istanbul coverage reports
```

### Cleaning & Formatting

```bash
npx gulp clean          # Remove build artifacts
npx gulp format         # Format code with Prettier
```

### API Client Generation

```bash
npx gulp apigen                       # Generate TypeScript clients from OpenAPI specs
npx gql-tada generate output          # Regenerate GraphQL types from src/graphql/sidecar.graphql
```

### Packaging

```bash
npx gulp bundle         # Create .vsix package for distribution
npx gulp clicktest      # Package and install locally for manual testing
```

## Architecture Overview

### Sidecar Process Pattern

The extension uses a separate `ide-sidecar` process for all heavy operations:

- **SidecarManager** (`src/sidecar/sidecarManager.ts`): Singleton managing the sidecar process
  lifecycle
- **SidecarHandle** (`src/sidecar/sidecarHandle.ts`): Short-lived client for individual operations
- **WebsocketManager** (`src/sidecar/websocketManager.ts`): Maintains persistent WebSocket
  connection for real-time updates

**Critical Pattern**: Always use short-lived handles via `await getSidecar()` → use handle →
discard. This enables automatic reconnection and proper resource management.

### View Provider Architecture

Tree views extend `BaseViewProvider` or `ParentedBaseViewProvider`:

- **BaseViewProvider** (`src/viewProviders/baseModels/base.ts`): Abstract base for all tree views
  with search/filter capability
- **ParentedBaseViewProvider** (`src/viewProviders/baseModels/parentedBase.ts`): For parent-child
  resource hierarchies (e.g., Topics under a Kafka Cluster)

**Main View Providers**:

- `ResourceViewProvider` - Environments, Kafka clusters, Schema registries
- `TopicViewProvider` - Topics within selected Kafka cluster
- `SchemasViewProvider` - Schemas within selected Schema Registry
- `FlinkStatementsViewProvider` - Flink SQL statements
- `FlinkDatabaseViewProvider` - Flink databases and tables

### Resource Loader Pattern

Abstract layer for loading resources from different connection types:

```
ResourceLoader (abstract base at src/loaders/resourceLoader.ts)
  └── CachingResourceLoader (intermediate abstract at src/loaders/cachingResourceLoader.ts)
      ├── CCloudResourceLoader - Confluent Cloud via OAuth
      ├── LocalResourceLoader - Local Docker-based Kafka/SR
      └── DirectResourceLoader - Direct TCP connections
```

- `CachingResourceLoader` encapsulates caching of environments, Kafka clusters, schema registries,
  and topics
- Generic types (EnvironmentType, KafkaClusterType, SchemaRegistryType) are defined at the
  CachingResourceLoader level
- Registry pattern: `ResourceLoader.getInstance(connectionId)` for lookup
- Constructed during extension activation in `constructResourceLoaderSingletons()`
- Uses GraphQL to query sidecar for resource metadata

### Client Code Generation

**NEVER manually edit** files in `src/clients/` - all auto-generated from OpenAPI specs.

**To modify client code**:

1. Update the OpenAPI spec in `src/clients/sidecar-openapi-specs/`
2. Run `npx gulp apigen`
3. Commit both the spec changes AND a `.patch` file to `src/clients/sidecar-openapi-specs/patches/`
   so subsequent generations apply cleanly

**GraphQL**: Uses `gql.tada` for type-safe queries. Schema at `src/graphql/sidecar.graphql`
generates `src/graphql/sidecarGraphQL.d.ts` (auto-generated, do not edit).

### Extension Settings Pattern

- Define settings in `src/extensionSettings/constants.ts` as `ExtensionSetting<T>` instances
- Must match `package.json`'s `contributes.configuration` sections
- Access via `.value` property - automatically syncs with VS Code configuration
- Changes handled by `src/extensionSettings/listener.ts`

### Webview Architecture

- HTML templates in `src/webview/*.html` with template variables & functions like `this.${var}()`
  bound to the `ViewModel` in corresponding `.ts` files
- Signal-based data binding for Template + ViewModel via custom template engine in
  `src/webview/bindings`
- Communication between webviews and VS Code host environment via `sendWebviewMessage()` and message
  handlers in `src/webview/comms`, which wrap the vscode webview message api to provide type safety
- General CSS styles in `src/webview/uikit/uikit.css` with view-specific overrides in individual
  HTML templates. VS Code color theme variables preferred and used when appropriate
- `@vscode/webview-ui-toolkit` is a deprecated dependency - don't use it in new code; use UIKit
  styles on HTML elements instead.

## Testing Strategy

### Unit Tests

- Co-located `.test.ts` files using Mocha + Sinon + assert
- Focus on isolated behavior, mocking external dependencies
- Use `.only` for focused testing (remember to remove before PR!)
- **Design for stubbing**: When writing new functions, avoid calling other functions in the same
  module that you'll need to stub—Sinon can only stub module exports, not internal calls within the
  same file. Extract such dependencies to separate modules or pass them as parameters.
- Do not test side effects like logging.
- Make sure to set up any common stubs in the top-level describe block to ensure they apply to all
  tests.

### Functional Tests

- Webview tests in `src/webview/*.spec.ts` using Playwright
- Test UI validation and user interactions

### E2E Tests

- Full workflows in `tests/e2e/` with Page Object Model pattern
- Located in separate directory from source code
- Require Docker for local Kafka/SR instances
- Do not include conditionals within E2E tests to manage tests dimensions, as it violates ESLint
  rules. Instead, use test tags and filtering at runtime.

## Critical Requirements

### 1. Disposable Resource Management (MANDATORY)

- **ALL** classes with event listeners MUST implement `vscode.Disposable`
- **ALWAYS** call `.dispose()` on resources when done - especially `.event()` listeners
- **USE** `DisposableCollection` base class (`src/utils/disposables.ts`) to manage multiple
  disposables automatically
- **PATTERN**: Store disposables from constructors, dispose in class `.dispose()` method

Example:

```typescript
class MyClass extends DisposableCollection {
  constructor() {
    super();
    // DisposableCollection provides this.disposables array
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration(...)
    );
  }
  // .dispose() is automatically handled by DisposableCollection
}
```

### 2. Type Safety (NO EXCEPTIONS)

- **NEVER** use `any` type - provide explicit types or interfaces
- **PREFER** `enum` over string union types for constants
- **REQUIRE** JSDoc comments on all exported functions and public class methods
- TypeScript strict mode is enforced - code must compile without errors

### 3. Single Responsibility Principle (ENFORCE STRICTLY)

- One class, one purpose - split classes with multiple responsibilities
- One function, one task - keep functions small and focused
- One file, one concept - group related functionality, separate unrelated
- Example: ResourceLoader handles loading, ResourceManager handles state, TreeProvider handles UI

## Error Handling

- **Logging**: Always use `logError()` utility (`src/utils/errors.ts`) for consistent error capture
  rather than `logger.warn()` or `logger.error()`
- **User-facing**: Use `showErrorNotificationWithButtons()` with "Open Logs" and "File Issue"
  actions
- **Messages**: Write actionable error messages explaining what happened, why, and how to resolve

## Connection Types

The extension supports three connection types, each with different resource loading strategies:

1. **CCLOUD**: Confluent Cloud via OAuth authentication

   - Uses `CCloudResourceLoader` with GraphQL queries to the sidecar
   - Sign-in/sign-out actions manage OAuth tokens
   - Access to Environments, Kafka clusters, Schema registries, Flink resources

2. **LOCAL**: Local Docker-based Kafka and Schema Registry

   - Uses `LocalResourceLoader` with Docker engine API
   - Automatically detects local Kafka/SR containers
   - No authentication required

3. **DIRECT**: Direct TCP connections to custom Kafka/SR endpoints
   - Uses `DirectResourceLoader` with manual connection configuration
   - Supports custom brokers and schema registry URLs
   - Optional SASL authentication

Each connection type has its own ResourceLoader implementation managing the specific connection
details and API calls.

## Development Setup

### Prerequisites

- Node.js 22.17.0 or later
- Visual Studio Code 1.96.2 or later
- Git 2.40.0 or later
- Optional: NVM for Node version management
- Optional: Global Gulp CLI (`npm install -g gulp`)

### First-Time Setup

```bash
# Clone and install dependencies
git clone <your-fork>
cd vscode
npm ci

# Build the extension
npx gulp build

# Run tests
npx gulp test
```

### Running the Extension

Use VS Code's Run and Debug tab with configurations from `.vscode/` folder, or press F5 to launch
Extension Development Host.

## Code References

When referencing code in comments or documentation, use the pattern `file_path:line_number` to help
others navigate to the source location.

Example: The connectToServer function marks clients as failed in `src/services/process.ts:712`.

## Local Development with Claude Code

When working with Claude Code during development:

### Code Generation Requests

- Reference existing patterns from the codebase (ResourceLoader, ViewProvider, DisposableCollection)
- Specify which connection type (CCloud, Direct, Local) when working with Kafka resources
- Request examples that follow the established testing patterns (Mocha/Sinon for units, Playwright
  for E2E)
- Ask for proper disposable management in any new classes or event listeners
- Request TypeScript interfaces for complex data structures rather than inline types

### Refactoring Assistance

- Preserve all existing comments when refactoring code
- Maintain the established architectural patterns (sidecar communication, view providers, resource
  loaders)
- Ensure refactored code follows the three critical requirements (disposables, type safety, single
  responsibility)
- Request TypeScript interfaces for complex data structures rather than inline types
- Don't introduce unnecessary abstractions or backwards compatibility shims

### Before Writing New Code

- **No decorative comment blocks**: Do not add large comment separators like `// ======...` or
  `// ------...` to divide sections of code. Readability should come from code structure itself
  (well-named functions, logical grouping, small files), not formatting.
- **Main functions first**: Place primary public functions and entry point handlers at the top of
  files, with utility/helper functions below. Readers should understand what a file does without
  scrolling past implementation details.
