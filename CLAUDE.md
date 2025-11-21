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
npx gulp build          # Development build
npx gulp build -w       # Watch mode
npx gulp check          # TypeScript type checking
npx gulp lint           # ESLint (add -f for auto-fix)
```

### Testing

```bash
npx gulp test                         # Unit tests (Mocha/Sinon)
npx gulp test -t "test name"          # Run specific test(s) by name
npx gulp functional                   # Webview tests (Playwright)
npx gulp e2e                          # End-to-end tests (Playwright)
npx gulp test --coverage              # Generate Istanbul coverage reports
```

### Cleaning & Formatting

```bash
npx gulp clean          # Remove build artifacts
npx gulp format         # Format code with Prettier
```

### API Client Generation

```bash
npx gulp apigen         # Generate TypeScript clients from OpenAPI specs
npx gql-tada generate output  # Regenerate GraphQL types
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
  ├── CCloudResourceLoader - Confluent Cloud via OAuth
  ├── LocalResourceLoader - Local Docker-based Kafka/SR
  └── DirectResourceLoader - Direct TCP connections
```

- Registry pattern: `ResourceLoader.getInstance(connectionId)` for lookup
- Constructed during extension activation in `constructResourceLoaderSingletons()`
- Uses GraphQL to query sidecar for resource metadata

### Client Code Generation

**NEVER manually edit** files in `src/clients/` - all auto-generated from OpenAPI specs.

**To modify client code**:

1. Update the OpenAPI spec in `src/clients/sidecar-openapi-specs/`
2. Run `npx gulp apigen`
3. Commit both the spec changes AND a `.patch` file to `src/clients/sidecar-openapi-specs/patches/`
   for reproducibility

**GraphQL**: Uses `gql.tada` for type-safe queries. Schema at `src/graphql/sidecar.graphql`
generates `src/graphql/sidecarGraphQL.d.ts` (auto-generated, do not edit).

### Extension Settings Pattern

- Define settings in `src/extensionSettings/constants.ts` as `ExtensionSetting<T>` instances
- Must match `package.json`'s `contributes.configuration` sections
- Access via `.value` property - automatically syncs with VS Code configuration
- Changes handled by `src/extensionSettings/listener.ts`

### Webview Architecture

- HTML templates in `src/webview/*.html` with template variables `${var}`
- TypeScript logic in corresponding `.ts` files using custom elements pattern
- Data binding via Observable patterns in `src/webview/bindings/`
- Communication via `sendWebviewMessage()` and message handlers

### Chat Participant (Copilot Integration)

- Tools in `src/chat/tools/` extend `BaseLanguageModelTool<T>`
- Handler in `src/chat/participant.ts` processes requests and streams responses
- Auto-registered via `registerChatTools()` with tool chaining support

## Testing Strategy

### Unit Tests

- Co-located `.test.ts` files using Mocha + Sinon + assert
- Focus on isolated behavior, mocking external dependencies
- Use `.only` for focused testing (remember to remove before PR!)

### Functional Tests

- Webview tests in `src/webview/*.spec.ts` using Playwright
- Test UI validation and user interactions

### E2E Tests

- Full workflows in `tests/e2e/` with Page Object Model pattern
- Located in separate directory from source code
- Require Docker for local Kafka/SR instances

## Critical Requirements

### 1. Disposable Resource Management (MANDATORY)

- **ALL** classes with event listeners MUST implement `vscode.Disposable`
- **ALWAYS** call `.dispose()` on resources when done
- **USE** `DisposableCollection` base class (`src/utils/disposables.ts`) to manage multiple
  disposables automatically
- **PATTERN**: Store disposables from constructors, dispose in class `.dispose()` method

Example:

```typescript
class MyClass extends DisposableCollection {
  constructor() {
    super();
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration(...)
    );
  }
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

- **Logging**: Always use `logError()` utility for consistent error capture
- **User-facing**: Use `showErrorNotificationWithButtons()` with "Open Logs" and "File Issue"
  actions
- **Messages**: Write actionable error messages explaining what happened, why, and how to resolve

## Important Guidelines

### Auto-Generated Code

- Never modify `src/clients/` directly - update OpenAPI specs and run `npx gulp apigen`
- Never modify `src/graphql/sidecarGraphQL.d.ts` - update schema and run
  `npx gql-tada generate output`

### Sidecar Pattern

- Use short-lived `SidecarHandle` instances
- Support automatic reconnection by not holding handles long-term
- Always `await getSidecar()` for each operation

### Over-Engineering

- Don't add features beyond what's requested
- Don't add error handling for scenarios that can't happen
- Don't create abstractions for one-time operations
- Keep solutions simple and focused on current requirements

### Backwards Compatibility

- Delete unused code completely - no `_vars`, re-exports, or `// removed` comments
- Make direct changes rather than adding compatibility shims

## Connection Types

The extension supports three connection types:

1. **CCLOUD**: Confluent Cloud via OAuth authentication
2. **LOCAL**: Local Docker-based Kafka and Schema Registry
3. **DIRECT**: Direct TCP connections to custom Kafka/SR endpoints

Sign-in/sign-out actions are specific to CCLOUD connections. LOCAL connections use the Docker engine
API. DIRECT connections are configured manually.

## Development Setup

### Prerequisites

- Node.js 22.17.0 or later
- Visual Studio Code 1.87.0 or later
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

### Testing Against Local Sidecar

1. Clone [`ide-sidecar`](https://github.com/confluentinc/ide-sidecar) and build the native
   executable:

   ```bash
   make clean mvn-package-native-no-tests
   ```

2. Copy the executable to this repository's `bin/` directory:

   ```bash
   cp ./target/ide-sidecar-0.*.0-runner /path/to/vscode/bin
   ```

3. Update `.versions/ide-sidecar.txt` to match the executable version

4. If OpenAPI or GraphQL schemas changed, copy them and run `npx gulp apigen`

5. Run `npx gulp ci` to verify everything builds correctly

## Code References

When referencing code in comments or documentation, use the pattern `file_path:line_number` to help
others navigate to the source location.

Example: The connectToServer function marks clients as failed in `src/services/process.ts:712`.

## PR Review Focus Areas

- **Disposable Management**: Verify all event listeners are properly disposed
- **Type Safety**: Ensure no `any` types and all interfaces are properly typed
- **Single Responsibility**: Check classes/functions maintain focused purposes
- **Sidecar Pattern**: Confirm proper use of short-lived `SidecarHandle` instances
- **Testing**: Validate new functionality includes appropriate tests
- **Error Handling**: Ensure consistent use of `logError()` and user-facing error messages
- **Comments**: Never delete existing comments unless they contain errors - enhance rather than
  remove
