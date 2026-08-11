---
paths:
  - src/**/*.test.ts
  - tests/unit/**/*
  - tests/stubs/**/*
  - tests/fixtures/**/*
---

# Unit Testing (Mocha + Sinon)

## Framework & Location

- Co-located `.test.ts` files using Mocha + Sinon + `assert`
- Run with `npx gulp test` or `npx gulp test -t "test name"` for specific tests
- Coverage: `npx gulp test --coverage`

## Key Patterns

- Use `.only` for focused testing during development (remove before PR!)
- Focus on isolated behavior, mocking external dependencies
- Do not test side effects like logging
- Set up common stubs in the top-level `describe` block so they apply to all tests

## Design for Stubbing

When writing new functions, avoid calling other functions in the same module that you'll need to
stub — Sinon can only stub **module exports**, not internal calls within the same file.

**Solutions:**

- Extract dependencies to separate modules
- Pass dependencies as parameters
- Use dependency injection patterns

## Stubbing Non-Public Methods

Sinon's `sandbox.stub(obj, "method")` only accepts public member names (`keyof T` excludes
`protected`/`private` members), so it cannot stub non-public methods directly. Use bracket notation
assignment instead: `obj["methodName"] = sandbox.stub()`.

- Bracket notation bypasses TypeScript's access modifier checks for keyword-declared
  `protected`/`private` members (not ES `#private` fields)
- Never use `as never` or `as any` to bypass access modifiers - bracket notation is type-aware and
  only bypasses visibility, while `as never` suppresses all type checking
- Direct assignment is not sandbox-managed, so `sandbox.restore()` won't undo it - ensure the object
  is re-created or re-assigned in `beforeEach` to prevent stubs from leaking across tests
- If the variable's declared type doesn't include the member, narrow it to the concrete subclass
  (e.g. `LocalResourceLoader` instead of `ResourceLoader`)

## Test Data

- Unit test fixtures in `tests/fixtures/`
- Shared stubs in `tests/stubs/`

## macOS: Local Electron Test Host Won't Launch (e.g. VS Code 1.131.0)

`npx gulp test` downloads a real VS Code build into `.vscode-test/vscode-darwin-arm64-<version>/`
(gitignored cache) and spawns it via `@vscode/test-electron@2.3.9` as the Extension Development
Host. Two independent problems show up together on newer VS Code releases (first seen with 1.131.0):

**1. `spawn .../Electron ENOENT`** — `@vscode/test-electron@2.3.9` hardcodes the launcher binary
name as `Electron`, but this VS Code build ships it renamed to `Code`. Fix locally (never commit —
this only touches the gitignored cache):

```bash
cd ".vscode-test/vscode-darwin-arm64-<version>/Visual Studio Code.app/Contents/MacOS/"
ln -s Code Electron
```

**2. `"Visual Studio Code" is damaged and can't be opened`** — adding that symlink modifies the
signed `.app` bundle's contents, which invalidates its code signature. macOS then refuses to launch
it and reports it as "damaged" (this is a broken-signature error, not a Gatekeeper quarantine issue
— no `com.apple.quarantine` xattr needs to be present for it to happen). Fix by re-signing ad hoc
after adding the symlink:

```bash
codesign --force --deep --sign - "Visual Studio Code.app"
```

Re-run `npx gulp test` after both steps.

**3. `bad option: --no-sandbox` (and every other flag), exit code 9** — the test host is being run
as plain Node instead of as Electron, so it rejects all of the Chromium/VS Code flags the runner
passes. The cause is an inherited `ELECTRON_RUN_AS_NODE=1`, which any terminal hosted inside VS Code
(or another Electron app) exports to its child processes — including agent sessions running in the
IDE. Confirm with `env | grep -i electron`, then run the suite with it stripped:

```bash
env -u ELECTRON_RUN_AS_NODE npx gulp test
```

`ELECTRON_NO_ATTACH_CONSOLE=1` is usually inherited alongside it, but it is harmless — verified
against VS Code 1.132.0: stripping `ELECTRON_RUN_AS_NODE` alone is enough, so there is no need to
unset both.

A quick tell that this is the problem rather than a broken bundle:
`.../Contents/MacOS/Code --version` prints a Node version (e.g. `v24.18.0`) instead of a VS Code
version.

**4. Global suite setup times out or fails with `PORT_IN_USE` on 26636** — activation starts the
sidecar, and the sidecar port is shared machine-wide. Another VS Code window running the
marketplace-installed Confluent extension (or a second dev host) already owns it, and it re-spawns
its own sidecar within seconds of being killed, so the test run loses the race repeatedly. Close the
other workspace (or disable its Confluent extension) rather than killing the sidecar process in a
loop.

If it still fails with `SIGKILL`, that's a genuine headless/no-GUI-session environment (e.g. a
sandboxed agent session without display access) — not a code or signing issue, and not fixable with
the above.
