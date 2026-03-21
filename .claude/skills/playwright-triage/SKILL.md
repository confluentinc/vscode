---
name: playwright-triage
description: >-
  Use when E2E Playwright tests fail, CI reports test failures, the user mentions "triage", "test
  failed", "flaky test", or wants to debug Electron/Playwright test results. Also use when
  investigating trace.zip files, test screenshots, or Playwright HTML report archives from CI.
allowed-tools: Read, Bash, Glob, Grep
---

# Playwright E2E Test Failure Triage

Skill for systematically triaging Playwright E2E test failures in this VS Code extension project.

## Artifact Formats

Artifacts come in two distinct formats depending on the source. Identify the format first before
triaging.

### Format A: Raw test-results (local runs)

Produced by local `npx gulp e2e` runs. Each failed test gets a directory under `test-results/`:

```
test-results/<test-title-slug>/
  test-failed-1.png       # screenshot at failure
  error-context.md        # accessibility tree (YAML)
  trace.zip               # Playwright trace (contains trace.trace NDJSON)
  attachments/
    vscode-confluent.log
    vscode-confluent-sidecar.log
    vscode-window-logs.zip
```

### Format B: Playwright HTML report (CI)

Produced by Semaphore CI and downloaded via `artifact pull`. Named like:
`playwright-report-<os>-<arch>-vscode-<version>--<suite>.zip`

**IMPORTANT**: Despite the `.zip` extension, these are gzipped tarballs (Semaphore `artifact push`
compresses directories with tar+gzip). Always detect the format before extracting:

```bash
file <path>              # check actual format
tar xzf <path> -C /tmp/pw-triage   # for gzipped tarballs (most CI artifacts)
unzip <path> -d /tmp/pw-triage     # for actual zip files (Windows CI only)
```

The extracted HTML report has this structure:

```
playwright-report/
  index.html              # HTML report viewer (not useful for CLI triage)
  data/
    <sha>.zip             # either Playwright traces OR VS Code log bundles
    <sha>.png             # failure screenshots
    <sha>.markdown        # accessibility tree snapshots
    <sha>.txt             # extension/sidecar log files
```

All files in `data/` use content-hash filenames with no test name association. To identify trace
zips vs log zips:

```bash
# find trace zips (contain trace.trace)
for f in <report>/data/*.zip; do
  if unzip -l "$f" 2>/dev/null | grep -q "trace.trace"; then
    echo "TRACE: $f"
  fi
done
```

Trace zips (~1.5-3MB) tend to be larger than log zips. Larger traces often indicate failing tests
(more actions before timeout).

## Triage Workflow

### 1. Locate and extract artifacts

**Local runs**: search for `test-results/` in the project root.

**CI artifacts**: the user provides a path. Detect format and extract:

```bash
file <path>                                    # detect gzip vs zip
mkdir -p /tmp/pw-triage
tar xzf <path> -C /tmp/pw-triage 2>/dev/null || unzip <path> -d /tmp/pw-triage
```

Then determine which format you're working with:

```bash
ls /tmp/pw-triage/                             # look for test-results/ or playwright-report/
```

For **HTML reports**, identify traces and screenshots:

```bash
# find trace zips
for f in /tmp/pw-triage/playwright-report/data/*.zip; do
  if unzip -l "$f" 2>/dev/null | grep -q "trace.trace"; then echo "TRACE: $(basename $f) ($(stat -f%z "$f" 2>/dev/null || stat -c%s "$f") bytes)"; fi
done

# list screenshots, accessibility snapshots, and logs
ls /tmp/pw-triage/playwright-report/data/*.png 2>/dev/null
ls /tmp/pw-triage/playwright-report/data/*.markdown 2>/dev/null
ls /tmp/pw-triage/playwright-report/data/*.txt 2>/dev/null
```

### 2. Read the failure screenshot

```
Read: <path>/test-failed-1.png           # raw test-results
Read: <report>/data/<sha>.png            # HTML report
```

Look for:

- **Modal dialogs** blocking the main window (a common failure mode)
- **Missing UI elements** that should have been visible
- **Error notifications** or unexpected overlays
- **Command palette** state (open, closed, blocked)

### 3. Read accessibility tree snapshot

```
Read: <path>/error-context.md            # raw test-results
Read: <report>/data/<sha>.markdown       # HTML report
```

This is a YAML accessibility tree (DOM snapshot) captured at failure time. Key things to look for:

- **`dialog` elements** - indicate modal dialogs that may block interaction
- **`[ref=...]` attributes** - unique element identifiers for cross-referencing with the trace
- **Button labels** - reveal what actions are available (e.g. "Close Modal Editor (Escape)")
- **Editor group state** - "Editor Group 1 (empty)" means no file is open in the main editor
- **Notification text** - check for error or blocking notifications

### 4. Parse the trace

The `parse-trace.cjs` script works with both raw trace zips and trace zips extracted from the HTML
report `data/` directory:

```bash
node .claude/skills/playwright-triage/parse-trace.cjs <path>/trace.zip
node .claude/skills/playwright-triage/parse-trace.cjs <report>/data/<sha>.zip
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

**Note**: `parse-trace.cjs` only works with zips that contain `trace.trace`. If you get "trace.trace
not found", the zip contains VS Code logs, not a Playwright trace.

### 5. Read logs (if needed)

If the above artifacts don't reveal the root cause, check the logs:

**Raw test-results**:

```
Glob: <path>/attachments/*
```

**HTML report** (logs are `.txt` files and some `.zip` files in `data/`):

```bash
# preview log files to identify which is which
for f in <report>/data/*.txt; do echo "=== $(basename $f) ==="; head -3 "$f"; echo; done
```

Log types:

- **Extension log** - starts with `[info] [extension] Extension version...`
- **Sidecar log** - starts with `[WARN] [io.quarkus.config]` or `[INFO] [io.confluent.idesidecar]`
- **VS Code window logs** - in zip files containing dated directories (e.g. `20260321T052058/`)

### 6. Correlate findings

Combine evidence from all sources:

1. **Screenshot** shows the visual symptom
2. **Accessibility tree** shows the DOM structure causing the issue
3. **Trace** shows the action sequence leading to failure
4. **Logs** show backend errors or timing issues

## CI Artifact Pipeline Reference

How test artifacts are created and uploaded in CI:

1. **Tests run** via `npx gulp e2e` (see `Gulpfile.js:899-929`)
2. **Reporters** configured in `tests/e2e/playwright.config.ts:32-47`:
   - CI uses `blob` reporter (one zip per test in `blob-report/`)
   - Local uses `html` reporter (generates `playwright-report/` directly)
3. **Blob reports merged** into HTML report by `mk-files/semaphore.mk:87-93`:
   - `npx playwright merge-reports --reporter html blob-report`
   - Result tarred with `tar -zcvf` (this is why the `.zip` is actually a gzipped tarball)
   - Pushed to Semaphore as
     `playwright-reports/playwright-report-<platform>-<arch>-vscode-<version>--<suite>.zip`
4. **Raw test-results** also pushed from `semaphore.yml:105-110` (directory push, also tar+gzip)

Key files for understanding the CI flow:

| File                             | What it does                                      |
| -------------------------------- | ------------------------------------------------- |
| `tests/e2e/playwright.config.ts` | Reporter config (blob in CI, html locally)        |
| `mk-files/semaphore.mk`          | Blob merge, tar+gzip, artifact push               |
| `.semaphore/playwright-e2e.yml`  | E2E pipeline jobs (Linux/ARM/Windows)             |
| `.semaphore/semaphore.yml`       | Main pipeline (Linux x64 tests + artifact upload) |
| `Gulpfile.js`                    | Gulp `e2e` task definition                        |
| `Makefile`                       | `test-playwright-e2e` target                      |

## Interactive Debugging

For reproducing failures locally:

```bash
# run with Playwright inspector for step-by-step debugging
PWDEBUG=1 npx gulp e2e -t "test name"

# run a specific test without the inspector
npx gulp e2e -t "test name"
```
