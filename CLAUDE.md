# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this
repository.

## Project Overview

**Confluent for VS Code** — a VS Code extension for building stream processing applications using
Confluent Cloud, Apache Kafka, and Apache Flink. Integrates with Confluent Cloud products and Apache
Kafka-compatible clusters within VS Code.

## Core Commands

```bash
npx gulp build              # Development build
npx gulp check              # TypeScript type checking
npx gulp lint               # ESLint (add -f for auto-fix)
npx gulp test               # Unit tests (Mocha/Sinon)
npx gulp test -t "name"     # Run specific test(s) by name
npx gulp functional          # Webview tests (Playwright)
npx gulp e2e                # End-to-end tests (Playwright + Electron)
npx gulp e2e -t "name"      # Run specific E2E test(s) by name
npx gulp test --coverage    # Generate Istanbul coverage reports
```

## Golden Rules

1. **Disposable resource management**: ALL event-listening classes MUST extend
   `DisposableCollection` (`src/utils/disposables.ts`). Push every `onDid*` subscription to
   `this.disposables`.
2. **Type safety**: NEVER use `any` type. Prefer `enum` over string union types. JSDoc on all
   exported functions and public methods. TypeScript strict mode enforced.
3. **Single responsibility**: one class/one purpose, one function/one task, one file/one concept.

## Disposable Pattern (MANDATORY)

Violations cause memory leaks and stale event handlers.

```typescript
class MyClass extends DisposableCollection {
  constructor() {
    super();
    this.disposables.push(vscode.workspace.onDidChangeConfiguration(...));
  }
  // .dispose() is automatically handled by DisposableCollection
}
```

Common mistakes:

- Subscribing to `onDid*` events without pushing the return value to disposables
- Creating event listeners in a class that doesn't extend DisposableCollection
- Forgetting to register the class itself for disposal in the activation code

## Error Handling

- Always use `logError()` (`src/errors.ts`) for consistent error capture rather than `logger.warn()`
  or `logger.error()`. Ensures proper context and telemetry.
- Use `showErrorNotificationWithButtons()` (`src/notifications.ts`) with "Open Logs" and "File
  Issue" actions for user-facing errors. Write actionable messages explaining what happened, why,
  and how to resolve it.

## Never Edit (Auto-Generated)

- `src/clients/` — generated from OpenAPI specs via `npx gulp apigen`
- `src/graphql/sidecarGraphQL.d.ts` — generated from `src/graphql/sidecar.graphql`

## Before Writing New Code

- Check if a similar pattern already exists in the codebase
- Design for stubbing: avoid calling same-module functions you'll need to stub (Sinon limitation)
- Follow the resource loader / view provider / sidecar patterns already in use
- New event listeners → extend `DisposableCollection`

## Code Style

- **Preserve comments**: when refactoring, keep existing comments. Update them if code changes.
- **No decorative comment blocks**: no `// ======...` or `// ------...` separators.
- **Main functions first**: primary public functions and entry points at the top of files, helpers
  below.

## Architecture Reference

Detailed architecture docs auto-load from `.claude/rules/` when you work on relevant files:

- `architecture/` — sidecar pattern, view providers, resource loaders, webview, client codegen,
  extension settings, connection types
- `testing/` — unit tests, functional tests, E2E tests
