---
applyTo: "**/*.ts,package.json"
description: "TypeScript patterns and VS Code extension development best practices"
---

# TypeScript and VS Code Extension Development

When writing TypeScript code for this VS Code extension:

## Type Safety and Code Quality - MANDATORY

- **NEVER** use `any` type - always provide explicit types or interfaces
- **PREFER** `enum` over string union types for constants
- **REQUIRE** JSDoc comments on all exported functions and public class methods
- TypeScript strict mode is enforced - code must compile without type errors

## Asynchronous Programming

- Use `async/await` over Promise chains for better readability
- Implement `Promise.all` for concurrent operations when possible
- Always handle promise rejections properly with try/catch blocks

## Code Style and Organization - ENFORCE STRICTLY

- Write self-documenting variable and function names
- **One class, one purpose** - if class does multiple things, split it
- **One function, one task** - keep functions small and focused
- **One file, one concept** - related functionality goes together, unrelated gets separated
- Use classes to encapsulate related functionality and state for better organization and testability
  - Example: ResourceLoader handles loading, ResourceManager handles state, TreeProvider handles UI

## Comment Preservation - CRITICAL

- **Never delete existing comments** unless they contain significant errors or gaps
- Comments provide valuable context about business logic, architectural decisions, and edge cases
- When refactoring, preserve and update comments rather than removing them
- If code seems self-explanatory, comments often explain the _why_ behind the implementation

## VS Code Extension Patterns

- **MANDATORY**: All classes that register event listeners MUST implement `vscode.Disposable`
- **ALWAYS** call `.dispose()` on resources when done - especially `.event()` listeners
- **Use** `DisposableCollection` base class to manage multiple disposables automatically
- **Pattern**: Store disposables from constructors, dispose in class `.dispose()` method
- **Example**: `this.disposables.push(vscode.workspace.onDidChangeConfiguration(...))`
- Use the extension's established command patterns for consistency
- Use the existing ResourceLoader and ResourceManager patterns for data fetching
- Follow VS Code extension API patterns for commands, tree providers, quickpicks, and webviews

## Configuration and Settings

- Use `ExtensionSetting<T>` instances defined in `src/extensionSettings/constants.ts`
- Access settings via `.value` property for automatic VS Code configuration sync
- Handle configuration changes through `src/extensionSettings/listener.ts` patterns
- Validate settings values before using them in critical operations
- Implement proper typing for all configuration values
- Use workspace-scoped settings for project-specific configurations
- Use user-scoped settings for user preferences

## Extension Settings in package.json

- Provide clear default values for all settings
- Document all settings in package.json with descriptions and valid values
- Use appropriate setting types (boolean, string, array, object)
- Group related settings with appropriate naming conventions
