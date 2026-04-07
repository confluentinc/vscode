---
paths:
  - src/viewProviders/**/*
  - src/panelProviders/**/*
---

# View Provider Architecture

Tree views extend `BaseViewProvider` or `ParentedBaseViewProvider`:

## Base Classes

- **BaseViewProvider** (`src/viewProviders/baseModels/base.ts`): abstract base for all tree views
  with built-in search/filter capability
- **ParentedBaseViewProvider** (`src/viewProviders/baseModels/parentedBase.ts`): for parent-child
  resource hierarchies (e.g., Topics under a Kafka Cluster)

## Main View Providers

| Provider                      | Purpose                              |
| ----------------------------- | ------------------------------------ |
| `ResourceViewProvider`        | Environments, Kafka clusters, SRs    |
| `TopicViewProvider`           | Topics within selected Kafka cluster |
| `SchemasViewProvider`         | Schemas within selected SR           |
| `FlinkStatementsViewProvider` | Flink SQL statements                 |
| `FlinkDatabaseViewProvider`   | Flink databases and tables           |

## Panel Providers

Panel providers in `src/panelProviders/` manage webview panels (full editor-area views) as opposed
to tree views in the sidebar. They typically use the webview architecture (see webview rules).

## Adding a New View Provider

1. Extend `BaseViewProvider` or `ParentedBaseViewProvider`
2. Register in `package.json` under `contributes.views`
3. Register the provider in the activation code
4. Ensure the class extends `DisposableCollection` for proper cleanup
