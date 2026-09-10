---
last-edited: 2026-05-14
repo: confluentinc/vscode
---

# Team Conventions for confluentinc/vscode

These conventions augment `CLAUDE.md`. Where they conflict, **`CLAUDE.md` wins** — codified rules
exist to keep AI agents out of risky territory where a human might reasonably navigate nuance. Edit
this file directly when conventions shift; rerun `/learn-conventions` periodically to surface
patterns this doc may have missed.

## High-confidence rules

- Prefer explicit, simple code over clever abstraction. Pull out helper layers when they hurt
  readability rather than building them up.
- Feature-scoped subdirs in `src/` over creating new top-level modules. Helpers live alongside the
  feature they support.

## Style

- Run Prettier locally — unformatted code is treated as a process smell.
- Don't over-shorten code into one-liners just for line count if it obscures intent.
- Side effects inside conditionals are surprising. Prefer separating `get()` from `reveal()` (or
  equivalent), even if it costs a line.

## Testing

- Mocha tests must be isolated. Rely on `globalBeforeAll` to activate the extension rather than
  assuming shared state from prior tests.
- Split real unit tests from integration-ish tests. Don't mix them in one window/environment.
- Fully stub external/API behavior in unit tests. Unstubbed loader/API calls cause noise and
  nondeterminism.
- Keep Playwright Page Object Models lean. Overbuilt POMs hurt clarity and should be ripped out when
  they do.
- Prefer explicit Playwright waits/assertions close to the behavior under test, even if verbose,
  over hidden helper magic.
- Use shared Playwright fixtures (e.g. coverage config) — don't duplicate test infrastructure.
- E2E coverage should hit realistic broad user flows first, not deep coverage of one UI area.
- E2E tests should verify visible webview UI affordances, not just backend effects.
- Use real-enough fixtures when behavior depends on realistic validation.
- `Promise.all` wrapping a Playwright load-state assertion can be a trap — the load state often
  resolves immediately. Awaiting the triggering command directly often gives better timing.
- Don't put `testInfo.skip()` inside `expect().toPass()`. `toPass` retries the throw and defeats the
  skip.

## Error handling & observability

- Surface the actual underlying cause to users, not a generic "check credentials or network"
  fallback.
- Validate user-entered config (file paths, etc.) locally before sending to sidecar. Give an
  explicit corrective message when the value is wrong.
- Log level reflects impact: loader fetch failures are warnings; sidecar transport problems are
  errors.
- Use `logError()` over `logger.error()` and `showErrorNotificationWithButtons()` over
  `window.showErrorMessage()` — corroborates CLAUDE.md.

## Architecture & module organization

- Centralize lifecycle/dispose wiring in a central listener layer. Don't bury extra listeners inside
  the managed class unless necessary.
- For singleton-ish managers, `dispose()` should also null out the instance so it can be recreated
  cleanly.
- Don't spread enable/disable hooks across many components — keep lifecycle gates near
  initialization.
- Resource/provider internals should maintain enough state for a top-level view refresh to be cheap
  and deterministic (cached repaint, no refetch).
- Prefer targeted fixes over broad central changes when centralization causes weird build or test
  behavior.

## Project-specific patterns

- Use `SidecarHandle` when sidecar is the natural integration boundary.
- Don't force everything through sidecar. Direct API client modules in a feature subdir are accepted
  (e.g. Docker engine API, scaffolding service).
- When a problem spans direct + CCloud paths and there's no single sidecar codepath to fix, fix it
  in the extension layer.

## Anti-patterns to avoid

- Overbuilding Page Object Models.
- Mixing unit and integration tests in one Mocha environment.
- Hiding important waits inside opaque helpers.
- Creating new top-level `src/` modules per feature.
- Forcing sidecar usage when a direct API call is clearer.
- `git push --force` without `--force-with-lease` on automation branches.

## External references

- [Playwright actionability / assertions](https://playwright.dev/docs/actionability#assertions) —
  baseline reference for E2E style decisions.
- [Rollwright coverage docs](https://unknownprinciple.github.io/rollwright/coverage.html) — webview
  test coverage setup.
- [`vscode-test-playwright`](https://www.npmjs.com/package/vscode-test-playwright) — basis for the
  E2E infrastructure used here.
