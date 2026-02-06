---
name: pr-review
description:
  Reviews pull requests for this VS Code extension. Use when reviewing PRs, doing self-review before
  sharing with the team, or when user mentions "review PR", "review changes", "self-review", or
  "check my PR". Focuses on project-specific patterns and critical requirements.
allowed-tools: Read, Bash, Grep, Glob, Task
---

# PR Review Skill

Reviews pull requests for the Confluent VS Code extension, focusing on project-specific patterns,
critical requirements, and architectural guidelines.

## Two Review Modes

### Self-Review Mode (for PR authors)

Use when: Author wants to check their changes before sharing with the team.

Goals:

- Catch issues early before formal review
- Verify critical requirements are met
- Ensure proper test coverage exists
- Validate architectural patterns are followed

### Formal Review Mode (for reviewers)

Use when: Reviewer needs to understand and evaluate a PR from another team member.

Goals:

- Quickly understand the scope and purpose of changes
- Identify potential issues or concerns
- Provide constructive feedback
- Verify checklist items are addressed

## Review Process

### Step 1: Gather Context

**For local changes (self-review):**

```bash
# See what files changed
git diff --name-only HEAD~1  # or compare against main
git diff main --name-only

# See the actual changes
git diff main --stat
git diff main
```

**For GitHub PRs:**

```bash
# Get PR details
gh pr view <PR_NUMBER> --json title,body,files,additions,deletions

# Get the diff
gh pr diff <PR_NUMBER>

# Get review comments if any
gh pr view <PR_NUMBER> --json reviews,comments
```

### Step 2: Filter Files for Review

**SKIP these paths entirely** (auto-generated code):

- `src/clients/kafkaRest/**`
- `src/clients/schemaRegistryRest/**`
- `src/clients/sidecar/**`
- `src/clients/flinkGateway/**`

**DO review these in `src/clients/`**:

- `src/clients/sidecar-openapi-specs/**` - OpenAPI specs and patches
- Files directly in `src/clients/` (not in subdirectories)

### Step 3: Understand the Changes

For each changed file, categorize it:

| Category         | File Patterns                          | What to Check                               |
| ---------------- | -------------------------------------- | ------------------------------------------- |
| View Providers   | `src/viewProviders/**`                 | Disposables, tree data patterns             |
| Resource Loaders | `src/loaders/**`                       | Caching, GraphQL queries, connection types  |
| Sidecar Code     | `src/sidecar/**`                       | Short-lived handles, reconnection patterns  |
| Commands         | `src/commands/**`                      | Registration, disposal, error handling      |
| Webviews         | `src/webview/**`                       | Template binding, message handling          |
| Settings         | `src/extensionSettings/**`             | ExtensionSetting<T> pattern, package.json   |
| Tests            | `**/*.test.ts`, `**/*.spec.ts`         | Coverage, mocking patterns, assertions      |
| E2E Tests        | `tests/e2e/**`                         | Page Object Model, no conditionals in tests |
| GraphQL          | `src/graphql/**`                       | Schema changes, query patterns              |
| OpenAPI Specs    | `src/clients/sidecar-openapi-specs/**` | Corresponding patches exist                 |

### Step 4: Check Critical Requirements

#### 1. Disposable Resource Management (MANDATORY)

Look for:

- [ ] Classes with event listeners implement `vscode.Disposable`
- [ ] Uses `DisposableCollection` base class OR manually manages `this.disposables`
- [ ] All `.event()` listeners are pushed to disposables
- [ ] Subscriptions from `onDid*` methods are stored and disposed

Red flags:

```typescript
// BAD: Event listener not stored
vscode.workspace.onDidChangeConfiguration(() => {});

// GOOD: Listener stored for disposal
this.disposables.push(vscode.workspace.onDidChangeConfiguration(() => {}));
```

#### 2. Type Safety (NO EXCEPTIONS)

Look for:

- [ ] No `any` types introduced
- [ ] Explicit types on function parameters and return values
- [ ] Interfaces defined for complex objects
- [ ] Enums used instead of string unions for constants
- [ ] JSDoc comments on exported functions and public methods

Red flags:

```typescript
// BAD: any type
function process(data: any) {}

// GOOD: explicit type
function process(data: KafkaMessage) {}
```

#### 3. Single Responsibility Principle

Look for:

- [ ] Each class has one clear purpose
- [ ] Functions are small and focused
- [ ] No "god objects" doing too many things
- [ ] Separation between loading, state management, and UI

### Step 5: Check Project-Specific Patterns

#### Sidecar Pattern

- [ ] Uses short-lived `SidecarHandle` via `getSidecar()`
- [ ] Handle is used and discarded (not stored long-term)
- [ ] No direct process management outside `SidecarManager`

#### Error Handling

- [ ] Uses `logError()` utility for error logging
- [ ] User-facing errors use `showErrorNotificationWithButtons()`
- [ ] Error messages are actionable (what, why, how to fix)

#### Testing

- [ ] New functionality has corresponding tests
- [ ] Unit tests use Mocha/Sinon patterns
- [ ] E2E tests follow Page Object Model
- [ ] No `.only` left in test files
- [ ] Stubs are set up correctly (functions to stub are in separate modules)

### Step 6: Verify VS Code API Usage

When changes involve VS Code APIs, use the `/vscode-api` skill to verify correct usage:

**When to use:**

- New event subscriptions (`onDid*`, `onWill*`)
- Tree view implementations (`TreeDataProvider`, `TreeItem`)
- Webview usage (`WebviewPanel`, `WebviewView`)
- Command registration and context
- Configuration API usage
- File system or workspace APIs
- Diagnostic or language feature APIs

**What to check:**

- [ ] API used correctly per official documentation
- [ ] No deprecated APIs introduced (check for `@deprecated` tags)
- [ ] Correct disposal patterns for the specific API
- [ ] Event return types handled properly
- [ ] Optional parameters used appropriately

**Example usage during review:**

```
/vscode-api TreeDataProvider getChildren
```

This verifies the implementation matches official VS Code patterns and catches subtle issues like:

- Missing optional method implementations
- Incorrect return types (e.g., `Thenable` vs `Promise`)
- Deprecated patterns that still compile but should be avoided

### Step 7: Check for Idiomatic VS Code Solutions

Beyond correct usage, check if there's a simpler, more VS Code-native approach. Use `/vscode-api` to
explore alternatives when you see custom implementations that VS Code might handle natively.

**Common opportunities for simplification:**

| Custom Implementation             | VS Code-Native Alternative                               |
| --------------------------------- | -------------------------------------------------------- |
| Custom input dialogs              | `vscode.window.showInputBox` with `validateInput`        |
| Custom selection UI               | `vscode.window.showQuickPick` with `QuickPickItem`       |
| Manual file watching              | `vscode.workspace.createFileSystemWatcher`               |
| Custom progress indicators        | `vscode.window.withProgress`                             |
| Manual tree item state            | `TreeItem.checkboxState`, `collapsibleState`             |
| Custom context tracking           | `vscode.commands.executeCommand('setContext', ...)`      |
| Manual command enablement         | `when` clause in `package.json` contribution             |
| Custom status indicators          | `vscode.window.createStatusBarItem`                      |
| Custom file decorations           | `FileDecorationProvider`                                 |
| Custom tooltip rendering          | `MarkdownString` with `supportHtml`                      |
| Manual workspace state            | `context.workspaceState` / `context.globalState`         |
| Custom multi-step wizards         | `vscode.window.createQuickPick` with back button support |
| Re-implementing standard commands | Built-in commands via `vscode.commands.executeCommand`   |
| Custom diff views                 | `vscode.commands.executeCommand('vscode.diff', ...)`     |
| Custom output handling            | `vscode.window.createOutputChannel`                      |

**What to look for:**

- [ ] Is there a built-in VS Code command that does this?
- [ ] Does VS Code provide a standard UI component for this interaction?
- [ ] Is the custom implementation duplicating VS Code's built-in behavior?
- [ ] Could `when` clauses replace manual visibility/enablement logic?
- [ ] Are there UX guidelines recommending a different approach?

**Example questions to ask:**

```
/vscode-api QuickPick back button multi-step
/vscode-api TreeItem contextValue when clause
/vscode-api built-in commands list
```

**When custom is appropriate:**

Not all custom implementations are wrong. Custom solutions are justified when:

- VS Code's built-in doesn't meet specific UX requirements
- Performance requires optimization beyond standard APIs
- The feature is genuinely novel with no VS Code equivalent
- Webview is needed for rich interactive content

When suggesting simplification, verify the alternative actually meets the requirements before
recommending changes.

### Step 8: Check PR Hygiene

- [ ] PR description explains the changes clearly
- [ ] Checklist items in PR template are addressed
- [ ] OpenAPI spec changes have corresponding patches
- [ ] No unrelated changes bundled in

## What NOT to Flag

### Style Preferences (Avoid Nitpicking)

- Import statements: `import type { }` vs `import { }` - both are valid
- Formatting issues - let ESLint/Prettier handle these
- Minor naming preferences when existing name is reasonable
- Comment style (as long as JSDoc is present where required)

### Comment Preservation

- NEVER suggest deleting existing comments
- Comments explain "why" not "what" - they may look redundant but provide context
- If updating code, preserve or update the comments - don't remove them

## Output Format

### For Self-Review

```markdown
## Self-Review Summary

### Changes Overview

[Brief summary of what changed]

### Critical Requirements Checklist

- [ ] Disposables: [status and any issues]
- [ ] Type Safety: [status and any issues]
- [ ] Single Responsibility: [status and any issues]

### Issues to Address Before PR

1. [High priority issue]
2. [Medium priority issue]

### Suggestions (Optional)

- [Nice-to-have improvements]

### Ready for Review?

[Yes/No with reasoning]
```

### For Formal Review

```markdown
## PR Review: #[number] - [title]

### Summary

[What this PR does in 2-3 sentences]

### Files Changed

- [Categorized list of changed files, excluding auto-generated]

### Analysis

#### What's Good

- [Positive aspects of the implementation]

#### Concerns

1. **[Issue Category]**: [Description and location]
   - Suggestion: [How to fix]

#### Questions

- [Clarifying questions for the author]

### Recommendation

[Approve / Request Changes / Comment with reasoning]
```

## Common Issues to Watch For

### Memory Leaks

- Event listeners not disposed
- Intervals/timeouts not cleared
- WebSocket connections not closed

### Race Conditions

- Async operations without proper error handling
- State mutations during async operations
- Multiple concurrent requests without coordination

### Security

- User input not sanitized
- Secrets or tokens in logs
- Eval or dynamic code execution

### Performance

- Unnecessary re-renders in tree views
- Large data structures held in memory
- Synchronous operations that should be async

## Tips

- Start with the PR description to understand intent
- Look at test files to understand expected behavior
- Check if changes align with existing patterns in similar files
- When in doubt, compare with existing implementations
- Use `Task` tool with Explore agent for deeper codebase context if needed
- Use `/vscode-api` to verify VS Code API usage against official docs - catches deprecated APIs and
  incorrect patterns that still compile
- Ask "is there a VS Code-native way to do this?" for any custom UI or state management - simpler
  solutions often exist via built-in APIs, commands, or `when` clause contributions
