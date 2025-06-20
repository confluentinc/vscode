---
applyTo: "**/*.ts,package.json"
description: "TypeScript patterns and VS Code extension development best practices"
---

# TypeScript and VS Code Extension Development

When writing TypeScript code for this VS Code extension:

## Type Safety and Code Quality

- Always use explicit types and interfaces, never use `any`
- Use discriminated unions for handling different states or types
- Prefer `enum` for fixed sets of related constants instead of union types
- Add JSDoc comments to exported functions, classes, and interfaces

## Asynchronous Programming

- Use `async/await` over Promise chains for better readability
- Implement `Promise.all` for concurrent operations when possible
- Always handle promise rejections properly with try/catch blocks

## Code Style and Organization

- Write self-documenting variable and function names
- Keep functions small and focused on a single responsibility
- Use classes to encapsulate related functionality and state for better organization and testability
- Follow functional programming patterns where appropriate

## VS Code Extension Patterns

- Properly handle `vscode.Disposable` resources to prevent memory leaks
- Use the extension's established command patterns for consistency
- Implement tree providers, quickpicks, and webviews according to VS Code patterns
- Use the existing ResourceLoader and ResourceManager patterns for data fetching
- Follow VS Code extension API patterns for commands, tree providers, quickpicks, and webviews

## Configuration and Settings

- Use VS Code's configuration API to access and update settings:
  ```typescript
  vscode.workspace.getConfiguration("confluent");
  ```
- Handle configuration changes with `vscode.workspace.onDidChangeConfiguration`
- Validate settings values before using them in critical operations
- Implement proper typing for all configuration values
- Use workspace-scoped settings for project-specific configurations
- Use user-scoped settings for user preferences

## Extension Settings in package.json

- Provide clear default values for all settings
- Document all settings in package.json with descriptions and valid values
- Use appropriate setting types (boolean, string, array, object)
- Group related settings with appropriate naming conventions
