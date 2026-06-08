---
paths:
  - tests/e2e/**/*
---

# End-to-End Tests (Playwright + Electron)

## Framework & Location

- Full workflow tests in `tests/e2e/` using Playwright + Electron
- Run with `npx gulp e2e` or `npx gulp e2e -t "test name"`
- Located in separate directory from source code

## Requirements

- Docker must be running for local Kafka/SR instances
- Extension Development Host launched via Playwright's `electron.launch()` API

## Key Patterns

- **Page Object Model**: page objects in `tests/e2e/objects/` abstract UI interactions
- **No conditionals in tests**: do not include conditionals within E2E tests to manage test
  dimensions (this violates ESLint rules). Instead, use test tags and filtering at runtime.
- Test files should exercise complete user workflows, not isolated units

## Selecting CCloud Resources (env-safe)

The CCloud test user can see multiple environments in the same org. Selecting an environment, Kafka
cluster, or Flink compute pool with `.first()` non-deterministically lands on whichever the renderer
happens to list first, leaking test-created resources into an unrelated environment.

- **Never `.first()` on a CCloud env / cluster / compute pool.** Pin the selection by its exact name
  from `tests/e2e/test-resources.ts`, the single source of non-secret CCloud identifiers (kept in
  source, not Vault, so changes go through PR review). Use the `*_NAME` defaults for "any available"
  resource, or `findCCloudResource(list, provider, region)` for provider-specific paths.
- **Assert exactly one match** with `await expect(locator).toHaveCount(1)` before acting:
  Playwright's `hasText` is a substring match, so without the guard a name that is a prefix of
  another env's resource would still pick the wrong item.
- **Route selections through the `ResourcesView` helpers** (`getEnvironment`, `getKafkaCluster`,
  `getFlinkComputePool`, and the shared `resolveCcloudLocator`), which already pin + assert
  single-match and throw with the list of visible names when the label is unset or ambiguous.
- Local and Direct connections are inherently single-environment / single-cluster, so `.first()` is
  acceptable there.

## Resource Naming & Cleanup

- **Name every test-created resource** (topics, Flink statements, SR subjects, Flink artifacts) with
  `e2eResourceName(slug)` from `tests/e2e/utils/uniqueName.ts`. It adds the shared `e2e-vscode-`
  prefix and a random suffix, so leftovers are easy to trace and collisions across parallel/repeated
  runs are avoided.
- **Each test deletes what it creates** (see the `topic` fixture in `baseTest.ts` and the Flink
  statement `afterEach`). There is intentionally **no global cleanup sweep**: a sweep could delete
  resources belonging to other concurrent CI or local runs. Add per-test teardown for any new
  resource type rather than relying on a sweep.
- **Deleting a Flink statement is phase-gated**: the extension only offers "Delete Statement" once
  the statement reaches a terminal phase (its tree item's context value flips to `deletable`). Stop
  a running statement and wait for a terminal status before the right-click, or the context menu
  shows only "Copy Name". `FlinkStatementsView.deleteStatement` encapsulates this.
