---
name: mocha
description:
  Use when the user asks about Mocha test runner APIs and patterns for unit tests. Triggers on
  questions like "Mocha hooks", "before/after setup", "describe/it structure", "async tests in
  Mocha", "test timeouts", ".only/.skip", "how to run a specific test", or test organization.
allowed-tools: Read, Bash, WebFetch, WebSearch
---

# Mocha Documentation Lookup

This skill helps look up Mocha test runner APIs, patterns, and best practices for writing unit tests
in this project.

## Sources

### Mocha Documentation

The official docs are a single-page site at `https://mochajs.org/`:

| Topic             | Anchor               | Use For                                      |
| ----------------- | -------------------- | -------------------------------------------- |
| Getting Started   | `#getting-started`   | Basic test structure                         |
| Assertions        | `#assertions`        | Assertion library integration                |
| Async Tests       | `#asynchronous-code` | Promises, async/await, callbacks             |
| Hooks             | `#hooks`             | `before`, `after`, `beforeEach`, `afterEach` |
| Pending Tests     | `#pending-tests`     | Tests without implementation                 |
| Exclusive Tests   | `#exclusive-tests`   | `.only` usage (dev only, never commit)       |
| Inclusive Tests   | `#inclusive-tests`   | `.skip` usage                                |
| Retry Tests       | `#retry-tests`       | `this.retries()` for flaky tests             |
| Timeouts          | `#timeouts`          | Suite and test-level timeout configuration   |
| Interfaces        | `#interfaces`        | BDD, TDD, exports, QUnit styles              |
| Root Hook Plugins | `#root-hook-plugins` | Global setup/teardown                        |

## Process

### 1. Understand the Question Context

Determine whether the user needs:

- **API reference**: Exact hook behavior, configuration options, CLI flags
- **Pattern guidance**: How to structure tests, organize suites, handle async
- **Troubleshooting**: Timeout issues, hook ordering, test isolation
- **Best practices**: Project-specific conventions

### 2. Check Project Conventions First

Before fetching external docs, review the project's unit testing conventions from CLAUDE.md:

- Co-located `.test.ts` files using Mocha + Sinon + `assert`
- Focus on isolated behavior, mocking external dependencies
- Common stubs go in the top-level `describe` block
- No `.only` left in committed code
- Don't test side effects like logging
- Run tests: `npx gulp test` or `npx gulp test -t "test name"`

### 3. Fetch Documentation

Mocha docs are a single long page — use targeted prompts:

```
WebFetch: https://mochajs.org/
Prompt: "Find the documentation about [hooks / async tests / timeouts / etc.]"
```

For specific features or newer APIs, supplement with web search:

```
WebSearch: "mocha root hook plugin setup example"
WebSearch: "mocha beforeEach async teardown pattern"
```

### 4. Look at Existing Test Examples

When the user needs pattern guidance, look at how the project structures its tests:

```bash
# Find test files
find src -name "*.test.ts" | head -10

# Find tests using specific patterns
grep -r "beforeEach" --include="*.test.ts" -l src/ | head -5
grep -r "describe(" --include="*.test.ts" -l src/ | head -5
```

Read 1-2 relevant test files to show project-specific patterns alongside official docs.

## Output Format

### API Reference

```markdown
## Mocha: [feature]

### API

[Description and behavior from docs]

### Example

[Code example from docs or adapted to project patterns]

### Project Usage

[How this is typically used in the project, with file references if found]
```

### Pattern Guidance

```markdown
## Pattern: [description]

### From the Docs

[Official recommended approach]

### In This Project

[How the project implements this pattern, with examples from existing tests]

### Key Points

- [Important considerations]
- [Common pitfalls to avoid]
```

## Common Lookup Patterns

- **Structure**: `describe()`, `it()`, `context()`
- **Hooks**: `before()`, `after()`, `beforeEach()`, `afterEach()`
- **Control**: `.only`, `.skip`, `this.timeout()`, `this.retries()`
- **Async**: `async/await`, returning Promises, `done` callback
- **Nesting**: Nested `describe` blocks for organizing related tests
- **Dynamic Tests**: Generating tests in loops

## Tips

- Mocha docs are a single long page — use targeted WebFetch prompts to extract the relevant section
- The project uses Node.js `assert` (not Chai) — adapt any Chai-based examples from docs to use
  `assert.strictEqual`, `assert.deepStrictEqual`, `assert.ok`, etc.
- Hook execution order matters: `before` runs once per `describe`, `beforeEach` runs before every
  `it` — the project convention is to put common stubs in the top-level `describe`'s `beforeEach`
- Never commit `.only` — it restricts the test run. Use `npx gulp test -t "name"` for focused runs
  instead
- When answering "how to run tests" questions, reference the project's gulp commands rather than
  bare `mocha` CLI since the project uses `@vscode/test-cli` for test execution
