---
name: vscode-api
description:
  Use when the user asks about VS Code API definitions, methods, interfaces, events, types, or wants
  to understand what VS Code APIs are available. Triggers on questions like "what does vscode.X do",
  "how to use VS Code API", "VS Code type definition", or checking API compatibility.
allowed-tools: Read, Bash, WebFetch, WebSearch
---

# VS Code API Lookup

This skill helps look up VS Code API definitions from official TypeScript declaration files and
documentation.

## Sources

### 1. TypeScript Definitions (vscode.d.ts)

The VS Code API type definitions come from the official repository:

- **Current version** (matching project's `@types/vscode`):
  `https://raw.githubusercontent.com/microsoft/vscode/{version}/src/vscode-dts/vscode.d.ts`

- **Latest (main branch)**:
  `https://raw.githubusercontent.com/microsoft/vscode/main/src/vscode-dts/vscode.d.ts`

### 2. VS Code API Documentation Website

The official documentation at `https://code.visualstudio.com/api` provides richer context including
screenshots, examples, and guides. Start with overview pages and navigate to subsections as needed:

| Section                | Entry Point                                      | Use For                                                      |
| ---------------------- | ------------------------------------------------ | ------------------------------------------------------------ |
| UX Guidelines          | `/api/ux-guidelines/overview`                    | UI/UX best practices, visual patterns                        |
| Extension Capabilities | `/api/extension-capabilities/overview`           | Common capabilities, extending workbench                     |
| Extension Guides       | `/api/extension-guides/overview`                 | Implementation guides (tree views, webviews, commands, etc.) |
| Language Extensions    | `/api/language-extensions/overview`              | LSP, syntax highlighting, language features                  |
| References             | `/api/references/vscode-api`                     | API docs, contribution points, activation events             |
| Testing & Publishing   | `/api/working-with-extensions/testing-extension` | Testing strategies, bundling                                 |
| Advanced Topics        | `/api/advanced-topics/extension-host`            | Extension host, remote development                           |

## Process

### 1. Determine the Project's VS Code Version

Read the project's `package.json` to find the `@types/vscode` version:

```bash
grep -A1 '"@types/vscode"' package.json
```

The version will be something like `"^1.96.0"` - extract the base version number (e.g., `1.96.0`).

### 2. Choose the Right Source

**Use vscode.d.ts when:**

- Looking up exact type signatures, interfaces, or method definitions
- Checking API compatibility with specific VS Code versions
- Understanding parameter types and return values

**Use the documentation website when:**

- Understanding UI/UX best practices and visual guidelines
- Looking for implementation examples and patterns
- Understanding how different APIs work together
- Evaluating design decisions for views, notifications, or other UI elements
- Learning about Language Server Protocol or language features

**Use both when:**

- Implementing a new feature that involves UI/UX decisions
- Need both the type signature AND usage context/examples

### 3. Fetch API Definitions (vscode.d.ts)

Use WebFetch to retrieve the vscode.d.ts file:

**For the project's current version:**

```
https://raw.githubusercontent.com/microsoft/vscode/{version}/src/vscode-dts/vscode.d.ts
```

**For the latest main branch:**

```
https://raw.githubusercontent.com/microsoft/vscode/main/src/vscode-dts/vscode.d.ts
```

### 4. Fetch Documentation Pages

Start with top-level section pages and explore subsections as needed. This approach generally stays
current as documentation evolves.

**Top-level entry points:**

```
https://code.visualstudio.com/api/ux-guidelines/overview
https://code.visualstudio.com/api/extension-capabilities/overview
https://code.visualstudio.com/api/extension-guides/overview
https://code.visualstudio.com/api/language-extensions/overview
https://code.visualstudio.com/api/references/vscode-api
https://code.visualstudio.com/api/working-with-extensions/testing-extension
https://code.visualstudio.com/api/advanced-topics/extension-host
```

**Navigation strategy:**

1. Fetch the relevant overview page first
2. Look for links to subsections in the page content
3. Fetch specific subsection pages based on user's question
4. This ensures you always find current content, even for rapidly evolving sections (e.g., AI
   extensibility)

### 5. Search for Specific APIs

When the user asks about a specific API (e.g., `TreeView`, `workspace.onDidChangeConfiguration`):

1. Fetch the vscode.d.ts file for type definitions
2. Search for the relevant interface, class, function, or type
3. Extract the definition along with JSDoc comments for context
4. If implementation guidance is needed, also fetch the relevant documentation page
5. Present both the API signature and contextual documentation

### 6. Compare Versions (Optional)

When the user wants to check for API changes or new features:

1. Fetch both the current version and main branch definitions
2. Compare the specific API or search for additions
3. Highlight differences, deprecations, or new additions

## Output Format

### Type Definitions Only

When presenting API definitions from vscode.d.ts:

```typescript
// From vscode.d.ts (version X.X.X)

/**
 * [JSDoc description from the file]
 */
interface/class/function ApiName {
  // ... relevant members
}
```

### Combined Type + Documentation

When presenting both type definitions and documentation context:

```
## API: [name]

### Type Definition
[TypeScript definition from vscode.d.ts]

### Documentation
[Summary from code.visualstudio.com/api]

### Key Points
- [Important usage notes]
- [Best practices from UX guidelines if applicable]
- [Related APIs or patterns]
```

### Version Comparison

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

### vscode.d.ts

- The vscode.d.ts file is large (~15,000+ lines) - always search for specific APIs rather than
  reading the whole file
- JSDoc comments in the file provide valuable usage guidance
- Deprecated APIs are marked with `@deprecated` tags
- Some APIs are proposed/experimental and may not be in stable releases

### Documentation Website

- Start with overview pages and navigate to subsections - avoids stale hardcoded URLs
- UX guidelines include screenshots showing recommended patterns - reference these for UI decisions
- Extension guides provide complete working examples, not just type signatures
- The documentation site is updated with each VS Code release and may include features not yet in
  stable
- When in doubt about "how" to implement something (not just "what" the API is), check the guides
- Some sections evolve rapidly (e.g., AI extensibility) - always fetch current content rather than
  assuming structure
