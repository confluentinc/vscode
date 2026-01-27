# Sidecar Removal Refactor - Implementation Plan

## Overview

This plan details the migration of the Confluent for VS Code extension away from the `ide-sidecar`
Java/Quarkus process to handle all authentication, connection management, and request proxying
internally.

---

## Architecture Summary

### Current Architecture (To Be Replaced)

```
VS Code Extension ──spawn──> ide-sidecar (Java/Quarkus on :26636)
     │                              │
     ├── REST API calls ───────────>│── Proxies to Kafka REST, Schema Registry, CCloud
     ├── GraphQL queries ──────────>│── Aggregates resources from multiple APIs
     └── WebSocket ────────────────>│── Real-time connection state events
```

### Target Architecture (Self-Contained)

```
VS Code Extension (TypeScript)
├── ConnectionManager (replaces SidecarManager)
│   ├── CCloudConnectionHandler (OAuth, token management)
│   ├── LocalConnectionHandler (Docker discovery)
│   └── DirectConnectionHandler (credentials, TLS)
├── HTTP Proxy Layer (direct API calls)
│   ├── KafkaRestProxy → Kafka clusters
│   ├── SchemaRegistryProxy → Schema Registries
│   └── CCloudProxy → CCloud control/data plane
├── ResourceFetchers (replaces GraphQL queries)
│   ├── CCloudResourceFetcher → CCloud REST APIs
│   ├── LocalResourceFetcher → Docker API
│   └── DirectResourceFetcher → configured endpoints
└── OAuth2 Authentication (internal PKCE flow)
    ├── URI Handler (primary, web-compatible)
    └── Local HTTP Server (fallback on :26636)
```

---

## Phase 1: Foundation Layer

**Goal**: Create base infrastructure for internal connection management

### Files to Create

| File                                            | Purpose                                                   |
| ----------------------------------------------- | --------------------------------------------------------- |
| `src/connections/connectionManager.ts`          | Singleton managing all connection states, CRUD operations |
| `src/connections/connectionState.ts`            | Connection state interfaces (mirrors sidecar models)      |
| `src/connections/connectionEvents.ts`           | Event emitters for state changes                          |
| `src/connections/connectionStorage.ts`          | Persistence using VS Code SecretStorage/Memento           |
| `src/connections/handlers/connectionHandler.ts` | Abstract base for connection type handlers                |
| `src/connections/handlers/ccloudHandler.ts`     | CCloud OAuth + token management                           |
| `src/connections/handlers/localHandler.ts`      | Docker discovery                                          |
| `src/connections/handlers/directHandler.ts`     | All credential types                                      |

### Key Types

```typescript
enum ConnectionType {
  CCLOUD,
  LOCAL,
  DIRECT,
}
enum ConnectedState {
  NONE,
  ATTEMPTING,
  SUCCESS,
  EXPIRED,
  FAILED,
}

interface ConnectionState {
  id: ConnectionId;
  spec: ConnectionSpec;
  status: ConnectionStatus;
  handler: ConnectionHandler;
}

interface ConnectionStatus {
  ccloud?: CCloudStatus;
  kafka_cluster?: KafkaClusterStatus;
  schema_registry?: SchemaRegistryStatus;
}
```

### Graphite Branch Stack

```
djs/vscode-lite
└── phase-1/connection-state-types
    └── phase-1/connection-storage
        └── phase-1/connection-handler-base
            └── phase-1/connection-handlers
                └── phase-1/connection-events
                    └── phase-1/connection-manager
```

---

## Phase 2: Authentication Layer

**Goal**: Implement OAuth2 PKCE flow and credential handling internally

### Critical: Dual Callback Implementation

Auth0 currently redirects to `http://127.0.0.1:26636/gateway/v1/callback-vscode-docs`. Until Auth0
config is updated:

1. **VS Code URI Handler** (primary): `vscode://confluentinc.vscode-confluent/callback`
2. **Local HTTP Server** (fallback): `:26636` for backwards compatibility

### Files to Create

| File                                         | Purpose                                       |
| -------------------------------------------- | --------------------------------------------- |
| `src/auth/oauth2/types.ts`                   | Token interfaces, OAuth config types          |
| `src/auth/oauth2/config.ts`                  | OAuth constants (client IDs, URIs, lifetimes) |
| `src/auth/oauth2/pkce.ts`                    | PKCE code verifier/challenge generation       |
| `src/auth/oauth2/tokenManager.ts`            | Token storage, refresh, expiry tracking       |
| `src/auth/oauth2/tokenExchange.ts`           | 3-step token exchange logic                   |
| `src/auth/oauth2/callbackServer.ts`          | Local HTTP server on :26636                   |
| `src/auth/oauth2/uriHandler.ts`              | VS Code URI handler integration               |
| `src/auth/oauth2/authService.ts`             | Unified callback handler                      |
| `src/auth/credentials/credentialResolver.ts` | Credential type resolution                    |
| `src/auth/credentials/mtlsHandler.ts`        | mTLS certificate handling                     |

### Files to Modify

| File                          | Changes                               |
| ----------------------------- | ------------------------------------- |
| `src/authn/ccloudProvider.ts` | Use internal OAuth instead of sidecar |
| `src/uriHandler.ts`           | Add OAuth callback path handling      |
| `src/storage/constants.ts`    | Add token storage keys                |

### Token Flow

1. Generate PKCE params (code_verifier, code_challenge, state)
2. Open browser to CCloud login with PKCE challenge
3. Receive callback (URI handler or HTTP server)
4. Exchange authorization code → ID Token (60s)
5. Exchange ID Token → Control Plane Token (300s)
6. Exchange Control Plane Token → Data Plane Token
7. Store in SecretStorage, schedule refresh

### Token Lifetimes (from sidecar config)

- ID Token: 60 seconds
- Control Plane Token: 300 seconds
- Refresh Token: 28800 seconds (8 hours), max 50 refresh attempts

### Graphite Branch Stack

```
djs/vscode-lite
└── phase-2/oauth-types
    └── phase-2/pkce-implementation
        └── phase-2/token-manager
            └── phase-2/token-exchange
                └── phase-2/callback-server
                    └── phase-2/uri-handler
                        └── phase-2/auth-service
                            └── phase-2/ccloud-provider-refactor
```

---

## Phase 3: HTTP Proxy Layer

**Goal**: Replace sidecar's request proxying with direct HTTP calls

### Files to Create

| File                               | Purpose                                        |
| ---------------------------------- | ---------------------------------------------- |
| `src/proxy/proxyClient.ts`         | Base HTTP client (fetch-based, web-compatible) |
| `src/proxy/proxyContext.ts`        | Request/response context                       |
| `src/proxy/authInjector.ts`        | Auth header injection per connection type      |
| `src/proxy/kafkaRestProxy.ts`      | Kafka REST v3 API proxy                        |
| `src/proxy/schemaRegistryProxy.ts` | Schema Registry API proxy                      |
| `src/proxy/ccloudProxy.ts`         | CCloud control + data plane proxy              |
| `src/proxy/tlsConfig.ts`           | TLS configuration resolver                     |

### Proxy Routing by Connection Type

| Connection | Kafka REST                                   | Schema Registry                      | CCloud APIs           |
| ---------- | -------------------------------------------- | ------------------------------------ | --------------------- |
| CCLOUD     | `{clusterId}.{region}.kafka.confluent.cloud` | `psrc-{id}.{region}.confluent.cloud` | `api.confluent.cloud` |
| LOCAL      | `localhost:8082`                             | `localhost:8081`                     | N/A                   |
| DIRECT     | User-configured bootstrap                    | User-configured URI                  | N/A                   |

### Authentication Injection

```typescript
// CCloud: OAuth Bearer token
{ Authorization: `Bearer ${dataPlaneToken}` }

// Direct (API Key):
{ Authorization: `Basic ${base64(key:secret)}` }

// Direct (SCRAM): Handled at Kafka client level
// Direct (mTLS): Handled at TLS layer
```

### Graphite Branch Stack

```
djs/vscode-lite
└── phase-3/proxy-client
    └── phase-3/proxy-context
        └── phase-3/auth-injector
            └── phase-3/kafka-rest-proxy
                └── phase-3/sr-proxy
                    └── phase-3/ccloud-proxy
```

---

## Phase 4: Resource Fetcher Layer

**Goal**: Replace GraphQL queries with direct REST API calls

### Files to Create

| File                                    | Purpose               |
| --------------------------------------- | --------------------- |
| `src/fetchers/resourceFetcher.ts`       | Interface definition  |
| `src/fetchers/ccloudResourceFetcher.ts` | CCloud REST API calls |
| `src/fetchers/localResourceFetcher.ts`  | Docker discovery      |
| `src/fetchers/directResourceFetcher.ts` | Endpoint validation   |
| `src/clients/ccloud/ccloudApiClient.ts` | CCloud API client     |
| `src/clients/ccloud/types.ts`           | CCloud response types |

### CCloud API Endpoints (Direct Calls)

| Resource            | Endpoint                                          |
| ------------------- | ------------------------------------------------- |
| Organizations       | `GET /api/org/v2/organizations`                   |
| Environments        | `GET /api/org/v2/environments`                    |
| Kafka Clusters      | `GET /api/cmk/v2/clusters?environment={id}`       |
| Schema Registries   | `GET /api/srcm/v3/clusters?environment={id}`      |
| Flink Compute Pools | `GET /api/fcpm/v2/compute-pools?environment={id}` |

### Files to Modify

| File                                   | Changes                                                  |
| -------------------------------------- | -------------------------------------------------------- |
| `src/loaders/cachingResourceLoader.ts` | Replace `getEnvironmentsFromGraphQL()` with fetcher call |
| `src/loaders/ccloudResourceLoader.ts`  | Inject CCloudResourceFetcher                             |
| `src/loaders/localResourceLoader.ts`   | Inject LocalResourceFetcher                              |
| `src/loaders/directResourceLoader.ts`  | Inject DirectResourceFetcher                             |

### Graphite Branch Stack

```
djs/vscode-lite
└── phase-4/fetcher-interface
    └── phase-4/http-client
        └── phase-4/ccloud-api-client
            └── phase-4/ccloud-fetcher
                └── phase-4/local-fetcher
                    └── phase-4/direct-fetcher
                        └── phase-4/loader-integration
```

---

## Phase 5: Flink Language Service

**Goal**: Connect directly to CCloud Flink LSP

### Files Created

| File                                          | Purpose                           |
| --------------------------------------------- | --------------------------------- |
| `src/flinkSql/privateEndpointResolver.ts`     | Private endpoint URL transforms   |
| `src/flinkSql/flinkLspAuth.ts`                | Auth handshake handling           |
| `src/flinkSql/flinkLanguageServiceClient.ts`  | Direct WebSocket to CCloud        |

### Files Modified

| File                                          | Changes                                      |
| --------------------------------------------- | -------------------------------------------- |
| `src/flinkSql/flinkLanguageClientManager.ts`  | Use direct client when flag enabled          |

### CCloud Flink LSP Endpoint

- Public: `wss://flinkpls.{region}.{provider}.confluent.cloud/lsp`
- Auth: Bearer token in headers + auth message after connect

### Private Endpoint Formats Supported

| Format       | Example Input                                              | Output                                                    |
| ------------ | ---------------------------------------------------------- | --------------------------------------------------------- |
| PLATTC       | `https://flink.us-west-2.aws.private.confluent.cloud`      | `wss://flinkpls.us-west-2.aws.private.confluent.cloud/lsp`|
| CCN Domain   | `https://flink.domid123.us-west-2.aws.confluent.cloud`     | `wss://flinkpls.domid123.us-west-2.aws.confluent.cloud/lsp`|
| CCN GLB      | `https://flink-nid.us-west-2.aws.glb.confluent.cloud`      | `wss://flinkpls-nid.us-west-2.aws.glb.confluent.cloud/lsp`|
| CCN Peering  | `https://flink-peerid.us-west-2.aws.confluent.cloud`       | `wss://flinkpls-peerid.us-west-2.aws.confluent.cloud/lsp` |

### Note: Connection Events

Connection state event wiring (ConnectionManager → existing emitters) will be handled in Phase 6
cleanup, not Phase 5.

---

## Phase 6: Cleanup & Removal

**Goal**: Remove all sidecar-related code

### Files to Remove

- `src/sidecar/sidecarManager.ts`
- `src/sidecar/sidecarHandle.ts`
- `src/sidecar/websocketManager.ts`
- `src/sidecar/connections/` (entire directory)
- `src/graphql/sidecar.graphql`
- `src/graphql/ccloud.ts`, `local.ts`, `direct.ts` (GraphQL queries)
- Sidecar binary from resources

### Files to Modify

- `src/extension.ts` - Remove sidecar initialization
- `package.json` - Remove sidecar bundling
- Build scripts - Remove sidecar packaging

---

## Feature Flags for Migration

```typescript
const MIGRATION_FLAGS = {
  "migration.useInternalConnectionManager": false,
  "migration.useInternalOAuth": false,
  "migration.useInternalProxy": false,
  "migration.useInternalFetchers": false,
  "migration.disableSidecar": false,
};
```

Use adapter pattern to toggle between old/new paths:

```typescript
export async function getConnection(id: ConnectionId): Promise<Connection | null> {
  if (isMigrationEnabled("migration.useInternalConnectionManager")) {
    return ConnectionManager.getInstance().getConnection(id);
  }
  return tryToGetConnection(id); // Sidecar path
}
```

---

## Implementation Order

### Recommended Sequence

| Week | Phase     | Focus                                |
| ---- | --------- | ------------------------------------ |
| 1    | Phase 1   | Connection state types, storage      |
| 2    | Phase 1   | Connection handlers, manager         |
| 3    | Phase 2   | PKCE, token manager                  |
| 4    | Phase 2   | Callback mechanisms (URI + HTTP)     |
| 5    | Phase 2   | Auth provider refactor               |
| 6    | Phase 3   | HTTP proxy client, auth injection    |
| 7    | Phase 3   | Kafka REST + Schema Registry proxies |
| 8    | Phase 4   | Resource fetchers                    |
| 9    | Phase 4   | Loader integration                   |
| 10   | Phase 5-6 | WebSocket, cleanup                   |

### Parallel Work Opportunities

- Phase 1 (connections) and Phase 2 (auth) can proceed in parallel
- Phase 3 (proxy) depends on Phase 1 + Phase 2
- Phase 4 (fetchers) depends on Phase 3
- Phase 5 (WebSocket) can be done anytime after Phase 1

---

## Testing Strategy

### Per-Phase Testing

1. **Unit Tests**: Each new module with mocked dependencies
2. **Integration Tests**: Feature flag toggles, data consistency
3. **E2E Tests**: Full flows with Docker for local Kafka/SR

### Parallel Path Validation

During migration, run both paths and compare:

```typescript
const sidecarResult = await sidecarPath();
const internalResult = await internalPath();
assert.deepEqual(sidecarResult, internalResult);
```

---

## Critical Files Reference

| File                                             | Purpose                            |
| ------------------------------------------------ | ---------------------------------- |
| `src/sidecar/sidecarManager.ts`                  | Current manager pattern to replace |
| `src/sidecar/sidecarHandle.ts`                   | API client factory pattern         |
| `src/authn/ccloudProvider.ts`                    | Auth provider to refactor          |
| `src/loaders/cachingResourceLoader.ts`           | Caching logic to preserve          |
| `src/graphql/ccloud.ts`                          | Data transformation logic          |
| `ide-sidecar/.../CCloudOAuthContext.java`        | OAuth implementation reference     |
| `ide-sidecar/.../ConnectionStateManager.java`    | Connection state reference         |
| `ide-sidecar/src/main/resources/application.yml` | Configuration values               |

---

## Sidecar Functionality Reference

This section documents the sidecar functionality that must be replicated internally.

### REST API Endpoints (from ide-sidecar)

| Endpoint                                                 | Purpose               | Migration Target      |
| -------------------------------------------------------- | --------------------- | --------------------- |
| `GET/POST /connections`                                  | Connection CRUD       | ConnectionManager     |
| `GET /handshake`                                         | Auth token generation | VS Code SecretStorage |
| `GET /callback-vscode-docs`                              | OAuth callback        | Internal OAuth flow   |
| `POST /clusters/{id}/topics/{name}/partitions/-/consume` | Message viewer        | ConsumerService       |
| `POST /query/{connection_id}`                            | Query execution       | QueryService          |
| `POST /produce/{connection_id}`                          | Message production    | ProducerService       |
| `GET/POST /kafka/v3/...`                                 | Kafka REST proxy      | KafkaRestProxy        |
| `GET/POST /schemas/...`                                  | Schema Registry proxy | SchemaRegistryProxy   |
| `GET /preferences`                                       | User preferences      | VS Code settings      |
| `GET /version`                                           | Version info          | Package.json version  |

### WebSocket Endpoints

| Endpoint | Purpose                | Migration Target           |
| -------- | ---------------------- | -------------------------- |
| `/ws`    | Control plane events   | EventEmitter-based system  |
| `/flsp`  | Flink Language Service | Direct WebSocket to CCloud |

### Configuration Values (from application.yml)

```typescript
const DEFAULTS = {
  // CCloud
  CCLOUD_BASE_PATH: "confluent.cloud",
  CCLOUD_CONTROL_PLANE_URL: "https://api.confluent.cloud",
  CCLOUD_OAUTH_CLIENT_ID: "confluent-vscode",
  CCLOUD_OAUTH_AUTHORIZE_URI: "https://login.confluent.io/oauth/authorize",
  CCLOUD_STATUS_CHECK_INTERVAL: 5000, // ms
  CCLOUD_REFRESH_INTERVAL: 5000, // ms

  // Local
  LOCAL_KAFKA_REST_URI: "http://localhost:8082",
  LOCAL_REFRESH_INTERVAL: 5000, // ms

  // Direct
  DIRECT_REFRESH_INTERVAL: 15000, // ms
  DIRECT_TIMEOUT: 15000, // ms

  // Kafka client
  KAFKA_CLIENT_ID: "Confluent for VS Code",
  KAFKA_API_TIMEOUT: 15000, // ms
};
```

---

## Success Criteria

1. Extension runs without spawning ide-sidecar process
2. All connection types work (CCloud, Local, Direct)
3. All credential types work (Basic, API Key, mTLS, SCRAM, Kerberos)
4. Feature parity with sidecar-based implementation
5. Works on VS Code desktop and web
6. All tests pass
7. Performance equal or better than sidecar

---

## Verification

### Manual Testing

1. Sign in to CCloud via OAuth flow
2. Create local connection with Docker
3. Create direct connection with various credential types
4. Browse topics, schemas, Flink resources
5. Produce/consume messages
6. Execute Flink SQL statements

### Automated Testing

```bash
npx gulp test                    # Unit tests
npx gulp functional              # Webview tests
npx gulp e2e                     # End-to-end tests
```

### Platform Testing

- macOS, Windows, Linux desktop
- VS Code for Web (if accessible)
- Remote SSH / Containers
