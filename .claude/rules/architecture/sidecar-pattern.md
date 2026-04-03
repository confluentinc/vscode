---
paths:
  - src/sidecar/**/*
---

# Sidecar Process Pattern

The extension uses a separate `ide-sidecar` process for all heavy operations (REST, GraphQL,
WebSocket APIs). The sidecar is a shared backend also consumed by the IntelliJ plugin.

## Key Components

- **SidecarManager** (`src/sidecar/sidecarManager.ts`): singleton managing the sidecar process
  lifecycle (start, stop, health checks)
- **SidecarHandle** (`src/sidecar/sidecarHandle.ts`): short-lived client for individual operations
- **WebsocketManager** (`src/sidecar/websocketManager.ts`): persistent WebSocket connection for
  real-time updates (topic messages, Flink statement results, etc.)

## Critical Pattern

Always use short-lived handles: `await getSidecar()` → use handle → discard. Never store a handle
long-term. This enables automatic reconnection and proper resource management.

```typescript
// correct: short-lived handle
const sidecar = await getSidecar();
const result = await sidecar.someOperation();

// wrong: storing handle as instance variable for reuse
this.sidecar = await getSidecar(); // don't do this
```

## Communication Protocols

- **REST**: OpenAPI-generated clients in `src/clients/` (auto-generated, never edit)
- **GraphQL**: `gql.tada` typed queries, schema at `src/graphql/sidecar.graphql`
- **WebSocket**: streaming data (topic consumption, Flink results) via WebsocketManager
