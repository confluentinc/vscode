---
name: cleanup
description:
  Runs a code cleanup, organization, and maintainability pass over a scope of code. Identifies tech
  debt, hygiene issues, and organization problems WITHOUT changing functionality, then reviews the
  findings with the user and applies ONLY the changes the user approves. Use when the user mentions
  "cleanup", "tech debt", "tidy", "tidy up", "maintainability pass", "code hygiene", "refactor
  pass", or asks for a periodic non-functional polish of code.
allowed-tools:
  - Read
  - Edit
  - Write
  - Bash
  - Grep
  - Glob
  - Task
---

# Cleanup Skill

Runs a non-functional cleanup, organization, and maintainability pass. Identifies issues, presents
them for review, and applies ONLY the user-approved subset.

## Core Rules

1. **No behavior changes.** Every proposed change must be functionally inert (a reasonable reader
   should be able to confirm that by inspection). If a finding requires a behavior change, surface
   it as a "needs-decision" note — do not silently apply it.
2. **Propose before changing.** Always present findings and let the user select what to apply. Never
   bulk-apply.
3. **Stay in scope.** Touch only files inside the agreed scope. Drive-by edits in unrelated files
   are forbidden.
4. **Preserve comments.** Do not delete existing comments. Update them if the surrounding code moves
   or is renamed.
5. **Respect generated code.** Skip `src/clients/kafkaRest/**`, `src/clients/schemaRegistryRest/**`,
   `src/clients/sidecar/**`, and `src/clients/flinkGateway/**`. They are regenerated from OpenAPI
   specs.
6. **Verify after.** After applying any approved batch, run the relevant checks (`npx gulp check`,
   `npx gulp lint`, and targeted `npx gulp test -t`) and report results.
7. **Load conventions.** Before scanning, read `.claude/skills/cleanup/conventions.md` if it exists.
   Treat its rules as authoritative team norms alongside `CLAUDE.md` — violations are must-fix or
   should-fix findings depending on severity. If the file is missing, proceed without it; do not
   auto-generate it. (Run `/learn-conventions` to populate or refresh that doc.) If a convention
   contradicts `CLAUDE.md`, `CLAUDE.md` wins.

## Process

### Step 1: Establish Scope

Determine the scope in this order:

1. **Explicit path or glob** the user named (e.g. `src/viewProviders/topicView.ts`,
   `src/loaders/**`). Use it directly.
2. **Branch diff vs `main`** if the user did not name a scope but the branch has uncommitted or
   committed changes (`git diff main --name-only` returns a non-empty list). Treat that as the scope
   for a pre-PR polish.
3. **No glob, no diff** — ask the user explicitly:

   > No scope was given and the branch is clean. Would you like to: A) Run a **full repo scan**
   > (slow — expect a high finding count and a longer review), B) Scope to a directory (give me a
   > path or glob), or C) Cancel?

   Do not default to a full scan silently. Always require explicit confirmation for it.

Once scope is fixed, list the files you will look at so the user can correct it before any work
happens. For a full repo scan, list directory-level counts instead of every file, and remind the
user that the auto-generated client directories will be skipped.

### Step 2: Gather Hard Signals

Run the cheap, deterministic checks first and collect their output:

```bash
npx gulp check    # TypeScript errors / warnings
npx gulp lint     # ESLint findings
```

Also gather:

- `git log --follow -- <file>` for files where age/ownership matters
- `grep -rn "TODO\|FIXME\|XXX\|HACK" <scope>` for self-flagged debt
- `grep -rn ": any\b\|as any\b" <scope>` for `any` usage (a CLAUDE.md violation)

These produce the unambiguous findings — list them under "Hard signals" in the report.

### Step 3: Scan for Soft Signals

These are heuristics — judgment is required, and many will be discarded. Read the files and look
for:

#### Organization

- Files mixing unrelated concerns (could be split)
- Helpers defined far from their only caller (could be co-located, or vice versa)
- Files in awkward locations (e.g. a view-provider helper sitting in `src/utils/`)
- Inconsistent file/module naming within a directory
- Re-exports that obscure the real definition site
- Circular or near-circular imports

#### Code Hygiene

- Unused exports, unused imports, unreachable code
- Dead branches (conditions that can never fire given the types)
- Duplicated literals that should be named constants
- Duplicated logic across 2–3 sites that could be a shared helper (be conservative — see CLAUDE.md
  "three similar lines is better than a premature abstraction")
- Magic numbers / hardcoded strings without explanation
- String unions where an `enum` would be clearer (per CLAUDE.md)
- Inconsistent error handling (e.g. `logger.error` instead of `logError()`)
- Inconsistent user-facing error surfacing (raw throws vs `showErrorNotificationWithButtons`)
- Functions doing two things — naming or length suggests split
- Names that no longer match what the symbol does
- Comments that contradict or no longer describe the code (UPDATE, do not delete)

#### Type Safety

- `any` types (always a finding per CLAUDE.md)
- Implicit `any` from missing annotations on exported functions
- Overly wide types (`object`, `Record<string, unknown>`) where a real interface exists
- Missing JSDoc on exported functions and public methods (CLAUDE.md requirement)

#### Disposable / Lifecycle (project-specific, CRITICAL)

- Classes with event subscriptions that don't extend `DisposableCollection`
- `onDid*` / `.event(...)` return values not pushed to `this.disposables`
- `setInterval` / `setTimeout` without a cleared handle
- Long-lived `SidecarHandle` references (handles should be short-lived per CLAUDE.md)
- Classes not registered in `context.subscriptions` where they should be

#### Test Hygiene

- `.only` left in test files (always flag)
- Tests stubbing functions defined in the same module (Sinon limitation per CLAUDE.md)
- Skipped tests with no linked issue/comment
- Test files mirroring source-file organization poorly

### Step 4: Analyze Test Coverage Over the Scope

Before recommending any code changes, evaluate the test safety net over the touched files. Code
without coverage is risky to refactor — surface test gaps **before** code findings so the user can
choose to land tests first.

For each file in scope, classify coverage:

- **Unit coverage**: is there a co-located or matching `*.test.ts`? Do its `describe`/`it` blocks
  reference the functions that would be touched by must-fix or should-fix findings? For a small
  scope, run `npx gulp test --coverage` and read the Istanbul report; for a large scope, rely on
  file existence + symbol-level greps.
- **E2E / behavioral coverage**: for command handlers, view providers, and webview code
  (`src/commands/**`, `src/viewProviders/**`, `src/webview/**`), grep `tests/e2e/**` for the command
  ID, view ID, or webview message type. Cross-check with `.claude/rules/testing/e2e-tests.md`.
- **Functional / webview coverage**: for webview-internal code, check `tests/functional/**` (or the
  project's webview test location) via the same symbol/route greps.

For each file, record one of: **covered**, **partial**, **uncovered**, and which specific findings
sit on uncovered code paths.

Generate a **Test Improvements** bucket from the gaps. Recommend landing tests **before** code
changes when:

- A must-fix or should-fix finding lives in an uncovered or partial area
- The change touches a high-risk surface (sidecar lifecycle, view providers, command handlers,
  webview message handlers)
- This is a periodic pass with no PR deadline pressure

If the user accepts test-improvement items, apply those first, get them green via
`npx gulp test -t "<name>"`, and only then proceed to the code findings. Any tests written by this
skill must follow `.claude/rules/testing/*.md` and the `/mocha`, `/sinon`, `/playwright` skill
patterns — and must be genuine new coverage, not assertion-free filler.

### Step 5: Categorize and Prioritize

Sort findings into:

| Bucket                | Meaning                                                  | Default recommendation     |
| --------------------- | -------------------------------------------------------- | -------------------------- |
| **Test Improvements** | Missing or thin coverage protecting code-change findings | Recommend landing FIRST    |
| **Must-fix**          | Violates CLAUDE.md rule (e.g. `any` type, disposables)   | Recommend applying         |
| **Should-fix**        | Clear improvement, low risk, no behavior change          | Recommend applying         |
| **Consider**          | Subjective; reasonable to leave as-is                    | Default to skipping        |
| **Needs decision**    | Touches behavior, scope, or a design choice              | Surface, do NOT auto-apply |

Findings that would change behavior — even subtly (error timing, log output a user might match on,
ordering of async work) — go into **Needs decision** and stay there unless the user explicitly
agrees the change is acceptable.

### Step 6: Present the Report

Output a single structured report. Cap the visible list at ~15 items across the actionable buckets.
Anything beyond that goes into a per-bucket remaining tally so the user knows what's been deferred
and can ask to see it. Use this format:

```markdown
## Cleanup Pass — <scope>

**Files inspected:** N **Hard-signal checks:** check ✓ / lint ✓ (or list failures) **Coverage
snapshot:** covered: X / partial: Y / uncovered: Z (of N files)

### Test Improvements — recommended FIRST (before code changes)

These protect the must-fix / should-fix changes below. Land these (or knowingly waive them) before
applying the code findings underneath.

T1. `src/foo/bar.ts` — no unit test exists; covers must-fix #1 and should-fix #3 - **Suggested:**
add `tests/.../bar.test.ts` with cases for <function>, <function> T2. `src/commands/openTopic.ts` —
no E2E flow exercises this command - **Suggested:** add a test under `tests/e2e/...` using the page
object pattern

### Must-fix (recommend applying all)

1. `path/to/file.ts:42` — <one-line description>
   - **Why:** <CLAUDE.md rule or concrete risk>
   - **Change:** <what the edit will do, in plain words>
   - **Coverage:** covered ✓ / partial ⚠ / uncovered ✗ (links to T# if a test was proposed)

### Should-fix (recommend applying all)

2. `path/to/file.ts:120` — <one-line description> ...

### Consider (default skip)

3. `path/to/file.ts:55` — <one-line description> ...

### Needs decision (NOT applied without explicit go-ahead)

4. `path/to/file.ts:88` — <one-line description>
   - **Why this is here:** <reason it isn't auto-applicable>
   - **Options:** A) ... B) ... C) leave as-is

### Remaining lower-priority items (not shown above)

Listed by bucket and rough scope so you know what's been deferred:

- Test Improvements: 4 more (3 unit-test gaps in `src/loaders/`, 1 E2E gap in `src/commands/`)
- Should-fix: 7 more (mostly missing JSDoc in `src/utils/**`, 2 magic-number extractions)
- Consider: 12 more (naming nits, comment refresh candidates, scoped across `src/viewProviders/**`)
- Needs decision: 2 more (both touching sidecar error surfacing — call out if you want details)

Ask to see any bucket in full and I'll list them.
```

Keep each finding to ~3 lines. The report should be skimmable — the user is making a triage
decision, not reading a design doc. The "Remaining lower-priority items" section must give real
counts and rough scope (directory or theme), not just "more available."

After the report, ask explicitly:

> Which findings would you like to apply? You can reply with:
>
> - `tests first` (apply Test Improvements only, then re-evaluate),
> - numbers (`T1, 1, 3, 5-7`),
> - `all must-fix` / `all should-fix`,
> - `all except 4`,
> - `show remaining <bucket>` to expand a deferred list,
> - `skip all`,
> - or describe the subset in words.

### Step 7: Apply the Approved Subset

For each approved finding:

1. Make the edit using `Edit` (or `Write` for new files only).
2. Keep edits minimal and localized — don't reformat surrounding code, don't rename unrelated
   symbols.
3. Preserve comments. If a comment is now wrong because of the edit, update it; never just delete
   it.
4. If during the edit you discover the change would alter behavior, STOP that finding and report
   back — do not silently push it through.

Group related edits into a single logical batch where it makes sense (e.g. all the
`logger.error → logError` replacements together), but still apply file-by-file so the user can audit
each diff.

### Step 8: Verify

After all approved edits are applied:

```bash
npx gulp check                 # type checking must pass
npx gulp lint                  # lint must pass (or only show pre-existing warnings)
npx gulp test -t "<scope>"     # relevant unit tests
```

If anything broke, report the failure and the specific edit that likely caused it. Offer to revert
that edit (`git checkout -- <file>`) rather than piling on more changes to fix the symptom.

### Step 9: Summarize

Brief summary at the end:

- Findings applied: N (list with file:line)
- Findings skipped: N
- Verification: check ✓ / lint ✓ / tests ✓
- Any remaining "needs decision" items still on the table

## What This Skill Does NOT Do

- **No feature work.** If a finding is "this would be nicer if we also added X," it goes to "needs
  decision" or gets dropped.
- **No rewrites.** Renaming a single misleading symbol is fine; restructuring a module is not — that
  belongs in a real PR with its own design.
- **No dependency changes.** Bumping versions, swapping libraries, adding new packages — all out of
  scope.
- **No test changes that alter assertions** (changing the meaning of a test). Removing `.only` or
  reorganizing test file structure is fine.
- **No silent behavior changes.** Anything that changes what a user, a caller, or telemetry would
  observe is "needs decision," full stop.
- **No "drive-by" edits** outside the agreed scope. Note them in the report if you spot them, but
  don't touch them.

## Anti-Patterns to Avoid

- Presenting 40 findings with no prioritization — the user can't make decisions on a wall of text.
  Cap the visible report at ~15 items and summarize the rest in the "Remaining lower-priority items"
  section with real counts and rough scope (directories or themes), not a vague "more available."
- Suggesting an abstraction for two similar code blocks. Per CLAUDE.md: three similar lines is
  better than a premature abstraction. Three call sites is the rough threshold for proposing a
  helper, and even then it goes in "consider."
- Suggesting "add error handling" without a specific failure mode. Per CLAUDE.md: don't add error
  handling for scenarios that can't happen.
- Flagging style preferences ESLint/Prettier would catch (or already accept). Hard signals from
  `npx gulp lint` are enough on those.
- Touching auto-generated client code under
  `src/clients/{kafkaRest,schemaRegistryRest,sidecar,flinkGateway}/**`.

## Tips

- Use the `Task` tool with the Explore agent for an initial sweep of a large scope — get a list of
  candidate files and obvious findings, then read the highest-signal ones yourself.
- When in doubt about whether a change is functionally inert, push it to "needs decision." That
  bucket exists precisely so judgment calls don't get silently merged in.
- Cross-reference suggestions against `.claude/rules/architecture/*.md` — proposing a change that
  contradicts an architectural rule means the proposal is wrong, not the rule.
- The `/pr-review` skill is for evaluating a finished change; this skill is for finding things to
  change. They are complementary — don't duplicate its output here.
- The `/simplify` skill operates on _changed_ code; this skill operates on a _scope_ the user picks.
  Use simplify after editing; use cleanup as a periodic pass.
