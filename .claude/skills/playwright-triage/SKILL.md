---
name: playwright-triage
description: >-
  Use when E2E Playwright tests fail, CI reports test failures, the user mentions "triage", "test
  failed", "flaky test", or wants to debug Electron/Playwright test results. Also use when
  investigating trace.zip files or test screenshots.
allowed-tools: Read, Bash, Glob, Grep
---

# Playwright E2E Test Failure Triage

Skill for systematically triaging Playwright E2E test failures in this VS Code extension project.

## Artifact Inventory

When a Playwright test fails, it generates artifacts in the test's output directory. Each artifact
serves a different purpose:

| Artifact            | Format        | How to inspect                                                 | What it tells you                        |
| ------------------- | ------------- | -------------------------------------------------------------- | ---------------------------------------- |
| `test-failed-*.png` | PNG           | `Read` (multimodal)                                            | Visual state of VS Code at failure point |
| `error-context.md`  | Markdown/YAML | `Read`                                                         | Accessibility tree (DOM snapshot)        |
| `trace.zip`         | ZIP (NDJSON)  | `node .claude/skills/playwright-triage/parse-trace.cjs <path>` | Ordered action sequence with errors      |
| `attachments/*.log` | Text          | `Read`                                                         | Extension, sidecar, and VS Code logs     |

## Artifact Sources

Artifacts can come from:

- **Local test runs**: `test-results/` in the project root (Playwright's default output directory)
- **CI downloads**: The user may provide a path to artifacts downloaded from Semaphore or another CI
  system (e.g. `~/Downloads/artifacts/`, `/tmp/ci-artifacts/`)
- **Direct paths**: The user may hand you a specific `trace.zip` or screenshot path

Do not assume `test-results/` is the only location. Always ask or search for the artifact path if
not provided.

## Triage Workflow

### 1. Locate artifacts

If the user hasn't provided a path, search locally:

```
Glob: **/test-results/**
```

Each failed test creates a directory like `test-results/<test-title-slug>/` containing the artifacts
listed above.

### 2. Read the failure screenshot

```
Read: <path>/test-failed-1.png
```

The screenshot shows the exact visual state of VS Code when the test failed. Look for:

- **Modal dialogs** blocking the main window (a common failure mode)
- **Missing UI elements** that should have been visible
- **Error notifications** or unexpected overlays
- **Command palette** state (open, closed, blocked)

### 3. Read `error-context.md`

```
Read: <path>/error-context.md
```

This is a YAML accessibility tree (DOM snapshot) captured at failure time. Key things to look for:

- **`dialog` elements** - indicate modal dialogs that may block interaction
- **`[ref=...]` attributes** - unique element identifiers for cross-referencing with the trace
- **Button labels** - reveal what actions are available (e.g. "Close Modal Editor (Escape)")
- **Editor group state** - "Editor Group 1 (empty)" means no file is open in the main editor
- **Notification text** - check for error or blocking notifications

### 4. Parse the trace

```bash
node .claude/skills/playwright-triage/parse-trace.cjs <path>/trace.zip
```

Or for an already-extracted trace:

```bash
node .claude/skills/playwright-triage/parse-trace.cjs <path>/trace.trace
```

The output is a numbered action sequence showing what Playwright did and where it failed:

```
  0 ok       | page.waitForLoadState   | sel=                                          |
  1 ok       | locator.waitFor         | sel=.monaco-workbench                         |
  2 error    | expect.toBeVisible      | sel=.quick-input-widget                       | err=Expect failed
```

Use this to identify:

- **The exact action that failed** (look for `error` status)
- **What happened before the failure** (the lead-up actions)
- **Whether the test got stuck in a loop** (repeated identical actions)
- **Timing gaps** between actions (potential load/render delays)

### 5. Read logs (if needed)

If the above artifacts don't reveal the root cause, check the attached logs:

```
Glob: <path>/attachments/*
```

- **`vscode-confluent.log`** - extension output (command execution, errors, sidecar communication)
- **`vscode-confluent-sidecar.log`** - sidecar process logs (API calls, auth, resource loading)
- **`vscode-window-logs.zip`** - VS Code internal logs (extension host, renderer, main process)

### 6. Correlate findings

Combine evidence from all sources:

1. **Screenshot** shows the visual symptom
2. **Accessibility tree** shows the DOM structure causing the issue
3. **Trace** shows the action sequence leading to failure
4. **Logs** show backend errors or timing issues

## Interactive Debugging

For reproducing failures locally:

```bash
# run with Playwright inspector for step-by-step debugging
PWDEBUG=1 npx gulp e2e -t "test name"

# run a specific test without the inspector
npx gulp e2e -t "test name"
```
