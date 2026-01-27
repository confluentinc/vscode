# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this
repository.

## Project Overview

This is the **Confluent for VS Code** extension - a VS Code extension for building stream processing
applications using Confluent Cloud, Apache Kafka, and Apache Flink. The extension integrates with
Confluent Cloud products and Apache Kafka-compatible clusters within VS Code.

### Active Migration Project

This codebase is undergoing a major architectural change to remove the `ide-sidecar` dependency.
For migration-specific details, see:

- **`SIDECAR_REMOVAL_REFACTOR.md`** - Architecture, phases, and implementation details
- **`IMPLEMENTATION_CHECKLIST.md`** - Progress tracking and task status

**Reference code** is available via symlinks in `.references/` (excluded from git):
- `.references/vscode/` - Current VS Code extension (reference for existing patterns)
- `.references/ide-sidecar/` - Java/Quarkus sidecar (reference for functionality to migrate)

---

## Core Commands

```bash
# Build & Development
npx gulp build          # Development build
npx gulp build -w       # Watch mode
npx gulp check          # TypeScript type checking
npx gulp lint           # ESLint (add -f for auto-fix)

# Testing
npx gulp test                         # Unit tests (Mocha/Sinon)
npx gulp test -t "test name"          # Run specific test(s) by name
npx gulp functional                   # Webview tests (Playwright)
npx gulp e2e                          # End-to-end tests (Playwright)
npx gulp test --coverage              # Generate Istanbul coverage reports

# Cleaning & Formatting
npx gulp clean          # Remove build artifacts
npx gulp format         # Format code with Prettier

# API Client Generation
npx gulp apigen                       # Generate TypeScript clients from OpenAPI specs
npx gql-tada generate output          # Regenerate GraphQL types

# Packaging
npx gulp bundle         # Create .vsix package for distribution
npx gulp clicktest      # Package and install locally for manual testing
```

---

## Architecture Overview

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
- **Migration Note**: Currently uses GraphQL to query sidecar - will be refactored to use internal
  services

### Client Code Generation

**NEVER manually edit** files in `src/clients/` - all auto-generated from OpenAPI specs.

**To modify client code**:

1. Update the OpenAPI spec in `src/clients/sidecar-openapi-specs/`
2. Run `npx gulp apigen`
3. Commit both the spec changes AND a `.patch` file to `src/clients/sidecar-openapi-specs/patches/`
   so subsequent generations apply cleanly

**GraphQL**: Uses `gql.tada` for type-safe queries. Schema at `src/graphql/sidecar.graphql`
generates `src/graphql/sidecarGraphQL.d.ts` (auto-generated, do not edit).

**Migration Note**: GraphQL queries will be replaced with direct API calls or an internal
abstraction layer.

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

---

## Testing Strategy

### Unit Tests

- Co-located `.test.ts` files using Mocha + Sinon + assert
- Focus on isolated behavior, mocking external dependencies
- Use `.only` for focused testing (remember to remove before PR!)
- **Design for stubbing**: When writing new functions, avoid calling other functions in the same
  module that you'll need to stub—Sinon can only stub module exports, not internal calls within the
  same file. Extract such dependencies to separate modules or pass them as parameters.

### Functional Tests

- Webview tests in `src/webview/*.spec.ts` using Playwright
- Test UI validation and user interactions

### E2E Tests

- Full workflows in `tests/e2e/` with Page Object Model pattern
- Located in separate directory from source code
- Require Docker for local Kafka/SR instances
- Do not include conditionals within E2E tests to manage tests dimensions, as it violates ESLint
  rules. Instead, use test tags and filtering at runtime.

### Migration Testing Strategy

For each migration phase:

1. Write unit tests for new internal services before implementation
2. Create integration tests that verify behavior matches sidecar behavior
3. Add feature flags to toggle between sidecar and internal implementation
4. Run parallel testing (both paths) before removing sidecar code

---

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

### 4. Web Platform Compatibility (NEW - MIGRATION)

- **AVOID** Node.js-specific APIs (fs, child_process, net) in core logic
- **USE** VS Code's file system API (`vscode.workspace.fs`) instead of Node fs
- **PREFER** fetch API over Node http/https modules
- **ISOLATE** platform-specific code behind abstractions
- **TEST** on VS Code for Web when possible

---

## Error Handling

- **Logging**: Always use `logError()` utility (`src/utils/errors.ts`) for consistent error capture
  rather than `logger.warn()` or `logger.error()`
- **User-facing**: Use `showErrorNotificationWithButtons()` with "Open Logs" and "File Issue"
  actions
- **Messages**: Write actionable error messages explaining what happened, why, and how to resolve

---

## Connection Types

The extension supports three connection types, each with different resource loading strategies:

1. **CCLOUD**: Confluent Cloud via OAuth authentication
   - Uses `CCloudResourceLoader` with GraphQL queries to the sidecar
   - Sign-in/sign-out actions manage OAuth tokens
   - Access to Environments, Kafka clusters, Schema registries, Flink resources
   - **Migration**: Will use internal OAuth flow and CCloud API proxy

2. **LOCAL**: Local Docker-based Kafka and Schema Registry
   - Uses `LocalResourceLoader` with Docker engine API
   - Automatically detects local Kafka/SR containers
   - No authentication required
   - **Migration**: Will use internal Docker client directly

3. **DIRECT**: Direct TCP connections to custom Kafka/SR endpoints
   - Uses `DirectResourceLoader` with manual connection configuration
   - Supports custom brokers and schema registry URLs
   - Optional SASL authentication
   - **Migration**: Will use internal Kafka/HTTP clients

Each connection type has its own ResourceLoader implementation managing the specific connection
details and API calls.

---

## Branching Strategy

### Feature Branch

All migration work happens on the `djs/vscode-lite` feature branch. Individual phases and tasks are
implemented as stacked branches managed with the Graphite CLI.

### Graphite CLI Workflow

We use Graphite CLI (`gt`) to manage a local stack of focused branches for easier implementation and
eventual review. Due to GitHub org settings, `gt submit` and `gt sync` are not available.

**CRITICAL: Create Branch BEFORE Starting Work**

Before writing ANY code for a new phase or step:

1. **Check current position**: `gt log short` to see where you are in the stack
2. **Navigate if needed**: `gt checkout <parent-branch>` to position correctly
3. **Create the new branch**: `gt create -m "phase-#/step-name"`
4. **Then start coding**: Only after the branch exists

This ensures all work is properly tracked and can be reviewed independently.

**Available Commands**:

```bash
gt create -m "phase-1/connection-manager"   # Create new branch in stack
gt modify -m "updated commit message"       # Amend current branch
gt restack                                  # Rebase stack after changes
gt move -o                                  # Move branch to different parent (--onto)
gt log short                                # View current stack
gt checkout <branch>                        # Switch between stack branches
gt bottom / gt top                          # Navigate to bottom/top of stack
gt up / gt down                             # Navigate up/down the stack
```

**Branch Naming Convention** (MUST follow):
- `phase-#/<summary>` for phase-level work (e.g., `phase-1/connection-manager`)
- `phase-#/step-#/<summary>` for step-level work within a phase (e.g., `phase-3/step-1/http-client`)

Base branch: `djs/vscode-lite`. See `IMPLEMENTATION_CHECKLIST.md` for current branch stack.

**Workflow Example**:

```bash
# Start new phase from feature branch
gt checkout djs/vscode-lite
gt create -m "phase-1/connection-manager"

# Add dependent work
gt create -m "phase-1/connection-state"

# After making changes to an earlier branch, restack
gt checkout phase-1/connection-manager
# ... make changes, commit ...
gt restack  # Rebases all dependent branches

# View the stack
gt log short
```

**Merging to Feature Branch**: Since `gt submit` is unavailable, branches are merged manually:

```bash
# When a branch is complete and reviewed
git checkout djs/vscode-lite
git merge --no-ff phase-1/connection-manager
gt restack  # Update remaining stack
```

**Important Notes**:

- **CREATE BRANCH BEFORE CODING** - Always run `gt create -m "phase-#/step-name"` before writing any
  code for a new phase or step. Never commit new work to an existing branch that should be separate.
- Keep branches focused on single concerns for easier review
- Restack frequently to avoid large merge conflicts
- Use `gt log short` to visualize the current stack state
- Commit messages should be descriptive - they'll become PR descriptions
- **NEVER push changes** - the user will handle all pushes manually
- **Always use `gt create`** for creating new branches, not `git checkout -b` or `git branch`

---

## Development Setup

### Prerequisites

- Node.js 22.17.0 or later
- Visual Studio Code 1.96.2 or later
- Git 2.40.0 or later
- Graphite CLI (`npm install -g @withgraphite/graphite-cli`)
- Optional: NVM for Node version management
- Optional: Global Gulp CLI (`npm install -g gulp`)

### First-Time Setup

```bash
# Clone and install dependencies
git clone <your-fork>
cd vscode-lite
npm ci

# Build the extension
npx gulp build

# Run tests
npx gulp test
```

### Running the Extension

Use VS Code's Run and Debug tab with configurations from `.vscode/` folder, or press F5 to launch
Extension Development Host.

---

## Code References

When referencing code in comments or documentation, use the pattern `file_path:line_number` to help
others navigate to the source location.

Example: The connectToServer function marks clients as failed in `src/services/process.ts:712`.

---

## Local Development with Claude Code

When working with Claude Code during development:

### Git and Branch Management (MANDATORY)

- **NEVER push changes** to remote repositories - the user handles all pushes manually
- **Always use Graphite CLI** (`gt create -m "branch-name"`) for creating branches, not git commands
- **CREATE BRANCH FIRST**: Before starting ANY new phase or step, create a properly named branch:
  ```bash
  gt log short                              # Check current position
  gt checkout <parent-branch>               # Navigate to correct parent
  gt create -m "phase-#/step-name"          # Create branch BEFORE coding
  ```
- Commit changes when requested, but stop there - do not push
- Each logical unit of work (phase step, feature, fix) should be on its own branch

### Fixing Linting and Formatting Errors

- Most linting and formatting errors can be fixed automatically with `npx gulp format`
- Run this command after making code changes to ensure consistent formatting
- For remaining lint errors after formatting, run `npx gulp lint -f` for auto-fixable issues

### Code Generation Requests

- Reference existing patterns from the codebase (ResourceLoader, ViewProvider, DisposableCollection)
- Specify which connection type (CCloud, Direct, Local) when working with Kafka resources
- Request examples that follow the established testing patterns (Mocha/Sinon for units, Playwright
  for E2E)
- Ask for proper disposable management in any new classes or event listeners
- Request TypeScript interfaces for complex data structures rather than inline types

### Refactoring Assistance

- Preserve all existing comments when refactoring code
- Maintain the established architectural patterns (view providers, resource loaders)
- Ensure refactored code follows the critical requirements (disposables, type safety, single
  responsibility)
- Request TypeScript interfaces for complex data structures rather than inline types
- Don't introduce unnecessary abstractions or backwards compatibility shims

### Migration-Specific Guidance

- Reference `SIDECAR_REMOVAL_REFACTOR.md` for architecture, phases, and implementation details
- Reference `IMPLEMENTATION_CHECKLIST.md` for task tracking and progress
- Reference `.references/ide-sidecar/` for sidecar functionality being migrated
- Reference `.references/vscode/` for existing VS Code extension patterns
- Write comprehensive tests before removing sidecar code paths

### Before Writing New Code

- **No decorative comment blocks**: Do not add large comment separators like `// ======...` or
  `// ------...` to divide sections of code. Readability should come from code structure itself
  (well-named functions, logical grouping, small files), not formatting.
- **Main functions first**: Place primary public functions and entry point handlers at the top of
  files, with utility/helper functions below. Readers should understand what a file does without
  scrolling past implementation details.
