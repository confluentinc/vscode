---
name: vscode-api
description: Use when the user asks about VS Code API definitions, methods, interfaces, events, types, or wants to understand what VS Code APIs are available. Triggers on questions like "what does vscode.X do", "how to use VS Code API", "VS Code type definition", or checking API compatibility.
tools: [Read, Bash, WebFetch]
---

# VS Code API Lookup

This skill helps look up VS Code API definitions from the official TypeScript declaration files.

## Source URLs

The VS Code API definitions come from the official repository:

- **Current version** (matching project's `@types/vscode`):
  `https://raw.githubusercontent.com/microsoft/vscode/{version}/src/vscode-dts/vscode.d.ts`

- **Latest (main branch)**:
  `https://raw.githubusercontent.com/microsoft/vscode/main/src/vscode-dts/vscode.d.ts`

## Process

### 1. Determine the Project's VS Code Version

Read the project's `package.json` to find the `@types/vscode` version:

```bash
grep -A1 '"@types/vscode"' package.json
```

The version will be something like `"^1.96.0"` - extract the base version number (e.g., `1.96.0`).

### 2. Fetch API Definitions

Use WebFetch to retrieve the vscode.d.ts file:

**For the project's current version:**
```
https://raw.githubusercontent.com/microsoft/vscode/{version}/src/vscode-dts/vscode.d.ts
```

**For the latest main branch:**
```
https://raw.githubusercontent.com/microsoft/vscode/main/src/vscode-dts/vscode.d.ts
```

### 3. Search for Specific APIs

When the user asks about a specific API (e.g., `TreeView`, `workspace.onDidChangeConfiguration`):

1. Fetch the vscode.d.ts file
2. Search for the relevant interface, class, function, or type
3. Extract the definition along with JSDoc comments for context
4. Present the API signature and description

### 4. Compare Versions (Optional)

When the user wants to check for API changes or new features:

1. Fetch both the current version and main branch definitions
2. Compare the specific API or search for additions
3. Highlight differences, deprecations, or new additions

## Output Format

When presenting API definitions:

```typescript
// From vscode.d.ts (version X.X.X)

/**
 * [JSDoc description from the file]
 */
interface/class/function ApiName {
  // ... relevant members
}
```

If comparing versions, show both with a summary of changes:

```
## API: [name]

### Current (v1.96.0)
[definition]

### Latest (main)
[definition]

### Changes
- [list of differences]
```

## Common Lookup Patterns

- **Interfaces**: `TreeDataProvider`, `TextDocument`, `Uri`, `Position`, `Range`
- **Namespaces**: `vscode.window`, `vscode.workspace`, `vscode.commands`
- **Events**: `onDid*` patterns like `onDidChangeConfiguration`
- **Disposables**: Classes implementing `Disposable`
- **Enums**: `TreeItemCollapsibleState`, `DiagnosticSeverity`

## Tips

- The vscode.d.ts file is large (~15,000+ lines) - always search for specific APIs rather than reading the whole file
- JSDoc comments in the file provide valuable usage guidance
- Deprecated APIs are marked with `@deprecated` tags
- Some APIs are proposed/experimental and may not be in stable releases
