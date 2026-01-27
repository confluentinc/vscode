# Sidecar Removal - Implementation Checklist

This checklist tracks all implementation tasks for the sidecar removal migration. Update task status as work progresses.

**Legend**: `[ ]` Not started | `[~]` In progress | `[x]` Complete | `[-]` Blocked/Deferred

---

## Phase 1: Foundation Layer

**Goal**: Create base infrastructure for internal connection management

### 1.1 Connection State Types
- [x] Create `src/connections/types.ts` (renamed from connectionState.ts for clarity)
  - [x] Define `ConnectionType` enum (CCLOUD, LOCAL, DIRECT)
  - [x] Define `ConnectedState` enum (NONE, ATTEMPTING, SUCCESS, EXPIRED, FAILED)
  - [x] Define `ConnectionSpec` interface (in `src/connections/spec.ts`)
  - [x] Define `ConnectionStatus` interface
  - [x] Define `CCloudStatus`, `KafkaClusterStatus`, `SchemaRegistryStatus` interfaces
  - [x] Define `ConnectionError` interface
  - [x] Define `CCloudUser` interface
  - [x] Define `TLSConfig` interface (in `src/connections/spec.ts`)
- [x] Create `src/connections/credentials.ts`
  - [x] Define `Credentials` union type
  - [x] Define `BasicCredentials` interface
  - [x] Define `ApiKeyCredentials` interface
  - [x] Define `OAuthCredentials` interface
  - [x] Define `ScramCredentials` interface
  - [x] Define `MtlsCredentials` interface
  - [x] Define `KerberosCredentials` interface
- [x] Write unit tests for type validation (47 tests in types.test.ts, credentials.test.ts, spec.test.ts)

### 1.2 Connection Storage
- [x] Create `src/connections/storage.ts` (renamed from connectionStorage.ts for consistency)
  - [x] Implement `ConnectionStorage` class
  - [x] Use VS Code `SecretStorage` for sensitive data (tokens, passwords)
  - [-] Use VS Code `Memento` for non-sensitive connection specs (deferred - using SecretStorage for all connection data since specs may contain credentials)
  - [x] Implement `saveConnection(spec: ConnectionSpec)` method
  - [x] Implement `getConnection(id: string)` method
  - [x] Implement `getAllConnections()` method
  - [x] Implement `deleteConnection(id: string)` method
  - [-] Implement migration from existing sidecar storage format (not needed - sidecar stores in memory only, no persistent data to migrate)
- [x] Write unit tests for ConnectionStorage (23 tests in storage.test.ts)

### 1.3 Connection Handler Base
- [x] Create `src/connections/handlers/connectionHandler.ts`
  - [x] Define abstract `ConnectionHandler` class
  - [x] Extend `DisposableCollection`
  - [x] Define abstract `connect()` method
  - [x] Define abstract `disconnect()` method
  - [x] Define abstract `testConnection()` method
  - [x] Define abstract `getStatus()` method
  - [x] Define abstract `refreshCredentials()` method
  - [x] Define abstract `isConnected()` method
  - [x] Define abstract `getOverallState()` method
  - [x] Define `ConnectionTestResult` interface
  - [x] Define `ConnectionStatusChangeEvent` interface
  - [x] Implement status change event emitter
- [x] Write unit tests for ConnectionHandler base (20 tests)

### 1.4 Connection Type Handlers
- [x] Create `src/connections/handlers/directConnectionHandler.ts`
  - [x] Implement `DirectConnectionHandler` class
  - [x] Support all credential types (Basic, API Key, SCRAM, OAuth, mTLS, Kerberos)
  - [x] Implement connection testing with validation
  - [x] Handle both Kafka and Schema Registry endpoints
  - [x] Write unit tests (35 tests)
- [x] Create `src/connections/handlers/localConnectionHandler.ts`
  - [x] Implement `LocalConnectionHandler` class
  - [x] Use Kafka REST proxy for connectivity (localhost:8082)
  - [x] Support optional Schema Registry URI via localConfig
  - [x] Configurable Kafka REST URI
  - [x] Write unit tests (24 tests)
- [x] Create `src/connections/handlers/ccloudConnectionHandler.ts`
  - [x] Implement `CCloudConnectionHandler` class
  - [~] Integrate with OAuth (Phase 2 dependency - placeholder implementation)
  - [x] Session lifetime tracking (8-hour max)
  - [x] Token refresh attempt limiting (max 50)
  - [x] User info and session expiry tracking
  - [x] Write unit tests (29 tests)
- [-] Organization/environment/cluster discovery (deferred to Phase 4 - Resource Fetcher Layer)

### 1.5 Connection Events
- [-] Create `src/connections/connectionEvents.ts` (integrated into ConnectionManager instead)
  - [x] Event emitters for: created, updated, deleted, status changed (via ConnectionManager)
  - [x] Typed event handlers (ConnectionCreatedEvent, ConnectionUpdatedEvent, etc.)
  - [x] Status change forwarding from handlers

### 1.6 Connection Manager
- [x] Create `src/connections/connectionManager.ts`
  - [x] Implement `ConnectionManager` singleton
  - [x] Extend `DisposableCollection`
  - [x] Implement `createConnection(spec: ConnectionSpec)` method
  - [x] Implement `updateConnection(id, spec)` method
  - [x] Implement `deleteConnection(id)` method
  - [x] Implement `getConnection(id)` method
  - [x] Implement `getAllConnections()` method
  - [x] Implement `connect(id)` method
  - [x] Implement `disconnect(id)` method
  - [x] Implement `testConnection(id)` method
  - [x] Implement `getConnectionStatus(id)` method
  - [x] Implement `isConnected(id)` method
  - [x] Implement handler factory based on connection type
  - [x] Wire up ConnectionStorage
  - [x] Event emitters integrated (created, updated, deleted, statusChanged)
- [x] Write unit tests for ConnectionManager (37 tests)
- [-] Integration tests comparing behavior to sidecar (deferred to Phase 6 - will validate during cleanup)

### 1.7 Feature Flag Integration
- [-] Feature flag integration deferred to Phase 3/4 when HTTP proxy and resource fetchers are ready
- [-] The flag will toggle between sidecar-based and internal connection management paths
- [-] Current Phase 1 implementation provides foundation; actual switching requires Phase 2-4 completion

---

## Phase 2: Authentication Layer

**Goal**: Implement OAuth2 PKCE flow and credential handling internally

### 2.1 OAuth Types and Configuration
- [x] Create `src/auth/oauth2/types.ts`
  - [x] Define `OAuthTokens` interface (id_token, access_token, refresh_token, expires_at)
  - [x] Define `PKCEParams` interface (code_verifier, code_challenge, state)
  - [x] Define `OAuthConfig` interface
  - [x] Define `TokenExchangeRequest` interface
  - [x] Define `TokenExchangeResponse` interface
- [x] Create `src/auth/oauth2/config.ts`
  - [x] Define CCloud OAuth endpoints (authorize, token)
  - [x] Define client ID (`confluent-vscode`)
  - [x] Define token lifetimes (ID: 60s, CP: 300s, Refresh: 28800s)
  - [x] Define max refresh attempts (50)
  - [x] Define callback URIs (URI handler + HTTP server)
- [x] Write unit tests (13 tests in types.test.ts, config.test.ts)

### 2.2 PKCE Implementation
- [x] Create `src/auth/oauth2/pkce.ts`
  - [x] Implement `generateCodeVerifier()` function (cryptographically random)
  - [x] Implement `generateCodeChallenge(verifier: string)` function (SHA-256, base64url)
  - [x] Implement `generateState()` function
  - [x] Implement `generatePKCEParams()` function
  - [x] Use Web Crypto API for cross-platform compatibility
- [x] Write unit tests for PKCE functions (12 tests)

### 2.3 Token Manager
- [x] Create `src/auth/oauth2/tokenManager.ts`
  - [x] Implement `TokenManager` class
  - [x] Extend `DisposableCollection`
  - [x] Store tokens in VS Code `SecretStorage`
  - [x] Implement `storeTokens(tokens: OAuthTokens)` method
  - [x] Implement `getTokens()` method
  - [x] Implement `clearTokens()` method
  - [x] Implement `isTokenExpired(token: string)` method
  - [x] Implement `getTimeUntilExpiry(token: string)` method
  - [x] Implement automatic refresh scheduling
  - [x] Track refresh attempt count (max 50)
  - [x] Emit events for: token_refreshed, token_expired, refresh_failed
- [x] Write unit tests for TokenManager (34 tests)

### 2.4 Token Exchange
- [x] Create `src/auth/oauth2/tokenExchange.ts`
  - [x] Implement `exchangeCodeForTokens(code, verifier, redirectUri)` function
  - [x] Implement `refreshAccessToken(refreshToken)` function
  - [x] Use fetch API for HTTP requests
  - [x] Handle token exchange errors with typed errors
- [x] Write unit tests for token exchange functions (17 tests)

### 2.5 OAuth Callback Server (Fallback)
- [x] Create `src/auth/oauth2/callbackServer.ts`
  - [x] Implement `OAuthCallbackServer` class
  - [x] Implement `vscode.Disposable`
  - [x] Listen on port 26636
  - [x] Handle `/gateway/v1/callback-vscode-docs` path
  - [x] Implement `isPortInUse()` check
  - [x] Gracefully handle port conflicts
  - [x] Parse authorization code from URL
  - [x] Parse error from URL
  - [x] Return HTML response to browser
  - [x] Forward callback to AuthService
- [x] Write unit tests for OAuthCallbackServer (15 tests)

### 2.6 VS Code URI Handler
- [x] Create `src/auth/oauth2/uriHandler.ts`
  - [x] Implement `OAuthUriHandler` class
  - [x] Implement `vscode.UriHandler` interface
  - [x] Handle `vscode://confluentinc.vscode-confluent/callback` URI
  - [x] Parse authorization code from query params
  - [x] Parse error from query params
  - [x] Forward callback to AuthService
- [-] Update `package.json` with URI handler contribution (deferred - requires Auth0 config update)
- [x] Write unit tests for OAuthUriHandler (12 tests)

### 2.7 Auth Service
- [x] Create `src/auth/oauth2/authService.ts`
  - [x] Implement `AuthService` class (singleton)
  - [x] Extend `DisposableCollection`
  - [x] Initialize PKCE params for OAuth flow
  - [x] Implement `startOAuthFlow()` method (opens browser)
  - [x] Implement `handleOAuthCallback(code: string)` method
  - [x] Implement `handleOAuthError(error: string)` method
  - [x] Coordinate TokenManager and TokenExchange
  - [x] Initialize both URI handler and callback server
  - [x] Emit events for: authenticated, authentication_failed, signed_out
- [x] Write unit tests for AuthService (28 tests)
- [-] Write integration tests for full OAuth flow (deferred to integration phase)

### 2.8 Credential Handlers
- [x] Create `src/auth/credentials/credentialResolver.ts`
  - [x] Implement `resolveCredentials(credentials: Credentials)` function
  - [x] Return appropriate headers/config for each credential type
- [x] Create `src/auth/credentials/basicHandler.ts`
  - [x] Implement Basic auth header generation
- [x] Create `src/auth/credentials/apiKeyHandler.ts`
  - [x] Implement API Key auth header generation (uses Basic auth format)
- [x] Create `src/auth/credentials/scramHandler.ts`
  - [x] Implement SCRAM credential config
- [x] Create `src/auth/credentials/mtlsHandler.ts`
  - [x] Implement mTLS certificate loading
  - [x] Handle certificate path resolution
- [x] Create `src/auth/credentials/kerberosHandler.ts`
  - [x] Implement Kerberos principal handling
  - [x] Handle keytab path resolution
- [x] Write unit tests for credential handlers (44 tests)

### 2.9 CCloud Provider Refactor
- [-] Modify `src/authn/ccloudProvider.ts` (deferred to Phase 6 - cleanup phase)
  - [-] Add feature flag check for internal OAuth
  - [-] Integrate with AuthService when flag enabled
  - [-] Maintain backward compatibility with sidecar path
- [-] Write tests comparing internal vs sidecar OAuth behavior (deferred)

### 2.10 Feature Flag Integration
- [-] Feature flag integration deferred to Phase 6
- [-] Will toggle between sidecar-based and internal OAuth paths
- [-] Current Phase 2 implementation provides the internal OAuth foundation

**Phase 2 Test Summary**: 175 tests total (types: 13, pkce: 12, tokenManager: 34, tokenExchange: 17, callbackServer: 15, uriHandler: 12, authService: 28, credentials: 44)

---

## Phase 3: HTTP Proxy Layer

**Goal**: Replace sidecar's request proxying with direct HTTP calls

### 3.1 HTTP Client Foundation
- [x] Create `src/proxy/httpClient.ts`
  - [x] Implement `HttpClient` class with createHttpClient factory
  - [x] Use fetch API (web-compatible)
  - [x] Implement retry logic with exponential backoff and jitter
  - [x] Implement configurable request timeout handling
  - [x] Implement `HttpError` class for API errors
  - [x] Implement `TimeoutError` class for timeout handling
  - [x] Support GET, POST, PUT, PATCH, DELETE methods
  - [x] Define `AuthConfig` type (bearer, basic, none)
  - [x] Inject OAuth Bearer token for CCloud
  - [x] Inject Basic auth for Direct connections
  - [x] Define `HttpResponse<T>` interface
  - [x] Define `RequestOptions` interface with params, headers, timeout, retries
- [x] Write unit tests for HttpClient (33 tests)

### 3.2 Kafka REST Proxy
- [x] Create `src/proxy/kafkaRestProxy.ts`
  - [x] Implement `KafkaRestProxy` class
  - [x] Implement topics list endpoint (`/kafka/v3/clusters/{id}/topics`)
  - [x] Implement topic get/create/delete endpoints
  - [x] Implement partitions list/get endpoints
  - [x] Implement topic configs list/get/update endpoints
  - [x] Implement message produce endpoint
  - [x] Implement topicExists helper
  - [x] Handle pagination
  - [x] URL encoding for special characters
- [x] Write unit tests for KafkaRestProxy (27 tests)

### 3.3 Schema Registry Proxy
- [x] Create `src/proxy/schemaRegistryProxy.ts`
  - [x] Implement `SchemaRegistryProxy` class
  - [x] Implement subjects list endpoint (`/subjects`)
  - [x] Implement schema versions endpoint (`/subjects/{subject}/versions`)
  - [x] Implement schema by ID endpoint (`/schemas/ids/{id}`)
  - [x] Implement schema registration endpoint
  - [x] Implement schema lookup endpoint
  - [x] Implement compatibility check endpoint
  - [x] Implement global/subject config endpoints
  - [x] Implement delete endpoints (subject, version)
  - [x] Implement getReferencedBy endpoint
  - [x] Handle schema types (Avro, Protobuf, JSON Schema)
  - [x] Support permanent delete option
- [x] Write unit tests for SchemaRegistryProxy (38 tests)

### 3.4 CCloud Control Plane Proxy
- [x] Create `src/proxy/ccloudControlPlaneProxy.ts`
  - [x] Implement `CCloudControlPlaneProxy` class
  - [x] Base URL: `https://api.confluent.cloud`
  - [x] Implement current user endpoint (`/api/iam/v2/users/me`)
  - [x] Implement organizations endpoint (`/api/org/v2/organizations`)
  - [x] Implement environments endpoint (`/api/org/v2/environments`)
  - [x] Implement Kafka clusters endpoint (`/api/cmk/v2/clusters`)
  - [x] Implement Schema Registry endpoint (`/api/srcm/v3/clusters`)
  - [x] Implement Flink compute pools endpoint (`/api/fcpm/v2/compute-pools`)
  - [x] Handle pagination with fetchAllPages helper
  - [x] Implement fetchAll* methods for each resource type
- [x] Write unit tests for CCloudControlPlaneProxy (24 tests)

### 3.5 CCloud Data Plane Proxy (Flink)
- [x] Create `src/proxy/ccloudDataPlaneProxy.ts`
  - [x] Implement `CCloudDataPlaneProxy` class
  - [x] Flink statements CRUD (`/sql/v1/.../statements`)
  - [x] Statement results endpoint (`/sql/v1/.../statements/{name}/results`)
  - [x] Statement exceptions endpoint (`/sql/v1/.../statements/{name}/exceptions`)
  - [x] Statement stop operation
  - [x] Flink workspaces CRUD (`/ws/v1/.../workspaces`)
  - [x] Handle pagination with fetchAllStatements/fetchAllWorkspaces
  - [x] URL encoding for special characters
- [x] Write unit tests for CCloudDataPlaneProxy (26 tests)

### 3.6 Module Exports
- [x] Create `src/proxy/index.ts`
  - [x] Export HttpClient, HttpError, TimeoutError, and types
  - [x] Export KafkaRestProxy and types
  - [x] Export SchemaRegistryProxy and types
  - [x] Export CCloudControlPlaneProxy and types
  - [x] Export CCloudDataPlaneProxy and types

### 3.7 TLS Configuration
- [-] TLS configuration deferred - mTLS handled via Node.js agent options when needed
- [-] Basic TLS (HTTPS) works out of the box with fetch API

### 3.8 Feature Flag Integration
- [-] Feature flag integration deferred to Phase 6
- [-] Will toggle between sidecar-based and internal proxy paths
- [-] Current Phase 3 implementation provides the internal proxy foundation

**Phase 3 Test Summary**: 148 tests total (httpClient: 33, kafkaRestProxy: 27, schemaRegistryProxy: 38, ccloudControlPlaneProxy: 24, ccloudDataPlaneProxy: 26)

---

## Phase 4: Resource Fetcher Layer

**Goal**: Replace GraphQL queries with direct REST API calls

### 4.1 Resource Fetcher Types
- [x] Create `src/fetchers/types.ts`
  - [x] Define `TopicData` interface for topic information
  - [x] Define `TopicFetcher` interface with `fetchTopics()` method
  - [x] Define `SchemaFetcher` interface with subject/schema methods
  - [x] Define `TopicFetchError` error class
  - [x] Define `SchemaFetchError` error class
- [x] Write unit tests for types (6 tests)

### 4.2 Topic Fetcher
- [x] Create `src/fetchers/topicFetcher.ts`
  - [x] Implement `TopicFetcherImpl` class using KafkaRestProxy
  - [x] Implement `fetchTopics(cluster)` method
  - [x] Filter virtual topics (replication_factor=0)
  - [x] Sort topics by name
  - [x] Handle private networking errors
  - [x] Auth config injection for clusters
- [x] Write unit tests for TopicFetcher (9 tests)

### 4.3 Schema Fetcher
- [x] Create `src/fetchers/schemaFetcher.ts`
  - [x] Implement `SchemaFetcherImpl` class using SchemaRegistryProxy
  - [x] Implement `fetchSubjects(schemaRegistry)` method
  - [x] Implement `fetchVersions(schemaRegistry, subject)` method
  - [x] Implement `fetchSchemasForSubject(schemaRegistry, subject)` method
  - [x] Implement `deleteSchemaVersion()` and `deleteSubject()` methods
  - [x] Concurrent version fetching with worker pool
  - [x] Handle schema type defaults (AVRO when not specified)
  - [x] Auth config injection for schema registries
- [x] Write unit tests for SchemaFetcher (18 tests)

### 4.4 CCloud Resource Fetcher
- [x] Create `src/fetchers/ccloudResourceFetcher.ts`
  - [x] Implement `CCloudResourceFetcherImpl` class using CCloudControlPlaneProxy
  - [x] Implement `fetchEnvironments()` method with nested resources
  - [x] Implement `fetchKafkaClusters(environmentId)` method
  - [x] Implement `fetchSchemaRegistries(environmentId)` method
  - [x] Implement `fetchFlinkComputePools(environmentId)` method
  - [x] Build CCloudEnvironment with nested clusters, SRs, Flink pools
  - [x] Associate Flink pools with clusters in same provider/region
  - [x] Sort environments by name
- [x] Write unit tests for CCloudResourceFetcher (14 tests)

### 4.5 Module Exports
- [x] Create `src/fetchers/index.ts`
  - [x] Export all fetcher types and interfaces
  - [x] Export factory functions (createTopicFetcher, createSchemaFetcher, createCCloudResourceFetcher)
  - [x] Export error classes

### 4.6 Local Resource Fetcher
- [x] Create `src/fetchers/localResourceFetcher.ts`
  - [x] Implement `LocalResourceFetcher` class
  - [x] Implement Docker API integration via existing `docker/containers.ts`
  - [x] Implement container discovery for Kafka, Schema Registry, Medusa
  - [x] Implement port mapping detection
  - [x] Implement Kafka REST endpoint detection (port 8082)
  - [x] Implement Schema Registry endpoint detection
  - [x] Build LocalEnvironment with discovered resources
- [x] Write unit tests for LocalResourceFetcher (14 tests)

### 4.7 Direct Resource Fetcher
- [x] Create `src/fetchers/directResourceFetcher.ts`
  - [x] Implement `DirectResourceFetcher` class
  - [x] Build DirectEnvironment from connection specs
  - [x] Generate consistent cluster/registry IDs from endpoints
  - [x] Handle Kafka-only, SR-only, and combined configurations
- [x] Write unit tests for DirectResourceFetcher (12 tests)

### 4.8 Loader Integration
- [-] Modify `src/loaders/cachingResourceLoader.ts` (not needed - integration at subclass level)
  - [-] Add feature flag check for internal fetchers
  - [-] Replace `getEnvironmentsFromGraphQL()` with fetcher call
  - [-] Update caching to work with new data format
- [x] Modify `src/loaders/ccloudResourceLoader.ts`
  - [x] Import `createCCloudResourceFetcher` from fetchers
  - [x] Check `USE_INTERNAL_FETCHERS` flag in `getEnvironmentsFromGraphQL()`
  - [x] Use fetcher when flag enabled, fall back to GraphQL
- [x] Modify `src/loaders/localResourceLoader.ts`
  - [x] Import `createLocalResourceFetcher` from fetchers
  - [x] Check `USE_INTERNAL_FETCHERS` flag in `getEnvironmentsFromGraphQL()`
  - [x] Use fetcher when flag enabled, fall back to GraphQL
- [x] Modify `src/loaders/directResourceLoader.ts`
  - [x] Import `createDirectResourceFetcher` from fetchers
  - [x] Check `USE_INTERNAL_FETCHERS` flag in `getEnvironmentsFromGraphQL()`
  - [x] Use fetcher when flag enabled, fall back to GraphQL
- [-] Write integration tests comparing GraphQL vs fetcher results (deferred to end-to-end testing)

### 4.9 Feature Flag Integration
- [-] Add `migration.useInternalFetchers` setting to `package.json` (hidden setting, not in package.json)
- [x] Add setting to `src/extensionSettings/constants.ts`
  - [x] Added `USE_INTERNAL_FETCHERS` as hidden `Setting<boolean>` type
  - [x] Key: `confluent.migration.useInternalFetchers`
  - [x] Default: false (use sidecar GraphQL)

**Phase 4 Test Summary**: 73 tests total (types: 6, topicFetcher: 9, schemaFetcher: 18, ccloudResourceFetcher: 14, localResourceFetcher: 14, directResourceFetcher: 12)

---

## Phase 5: WebSocket Layer

**Goal**: Replace sidecar WebSocket with direct connections or event emitters

### 5.1 Event Router
- [ ] Create `src/websocket/eventRouter.ts`
  - [ ] Implement `EventRouter` class
  - [ ] Replace WebSocket-based events with internal EventEmitter
  - [ ] Route connection state changes
  - [ ] Route resource update notifications

### 5.2 CCloud WebSocket (if needed)
- [ ] Evaluate if direct CCloud WebSocket is required
- [ ] Create `src/websocket/ccloudWebsocket.ts` (if needed)
  - [ ] Implement direct WebSocket connection to CCloud
  - [ ] Handle reconnection logic
  - [ ] Parse and route messages

### 5.3 Flink Language Service
- [ ] Create `src/websocket/flinkLanguageService.ts`
  - [ ] Implement `FlinkLanguageServiceProxy` class
  - [ ] Establish direct WebSocket to CCloud data plane
  - [ ] Handle LSP message routing
  - [ ] Implement reconnection logic
- [ ] Write unit tests for FlinkLanguageServiceProxy

---

## Phase 6: Cleanup & Removal

**Goal**: Remove all sidecar-related code

### 6.1 Extension Activation Update
- [ ] Modify `src/extension.ts`
  - [ ] Remove sidecar initialization code
  - [ ] Initialize ConnectionManager instead
  - [ ] Initialize AuthService
  - [ ] Initialize proxy clients
  - [ ] Update disposal handling

### 6.2 Sidecar Code Removal
- [ ] Remove `src/sidecar/sidecarManager.ts`
- [ ] Remove `src/sidecar/sidecarHandle.ts`
- [ ] Remove `src/sidecar/websocketManager.ts`
- [ ] Remove `src/sidecar/connections/` directory
- [ ] Remove any other sidecar-related files

### 6.3 GraphQL Removal
- [ ] Remove `src/graphql/sidecar.graphql`
- [ ] Remove `src/graphql/ccloud.ts`
- [ ] Remove `src/graphql/local.ts`
- [ ] Remove `src/graphql/direct.ts`
- [ ] Remove `src/graphql/sidecarGraphQL.d.ts`
- [ ] Remove gql.tada dependencies (if no longer needed)

### 6.4 Build Process Update
- [ ] Remove sidecar binary from resources
- [ ] Update `gulpfile.js` to remove sidecar packaging
- [ ] Update `.vscodeignore` if needed
- [ ] Update `package.json` scripts

### 6.5 Feature Flag Cleanup
- [ ] Remove all `migration.*` feature flags
- [ ] Remove adapter functions
- [ ] Remove conditional code paths

### 6.6 Documentation Update
- [ ] Update README.md
- [ ] Update CLAUDE.md to remove sidecar references
- [ ] Archive or remove SIDECAR_REMOVAL_REFACTOR.md
- [ ] Archive this checklist

---

## Testing Milestones

### Unit Test Coverage
- [x] Phase 1: Connection management tests passing (215 tests)
- [x] Phase 2: Authentication tests passing (175 tests)
- [x] Phase 3: Proxy layer tests passing (148 tests)
- [x] Phase 4: Resource fetcher tests passing (73 tests)
- [ ] Phase 5: WebSocket layer tests passing
- [ ] Overall coverage target: 80%+
- **Total tests so far: 611 tests**

### Integration Testing
- [ ] CCloud connection flow works end-to-end
- [ ] Local Docker connection flow works end-to-end
- [ ] Direct connection flow works end-to-end
- [ ] Parallel path validation passes (sidecar vs internal)

### E2E Testing
- [ ] All existing E2E tests pass with internal implementation
- [ ] OAuth flow works on desktop
- [ ] OAuth flow works on web (when URI handler enabled in Auth0)
- [ ] Message viewer works
- [ ] Schema browser works
- [ ] Flink SQL execution works

### Platform Testing
- [ ] macOS desktop verified
- [ ] Windows desktop verified
- [ ] Linux desktop verified
- [ ] VS Code for Web verified (when available)
- [ ] Remote SSH verified
- [ ] Remote Containers verified

---

## External Dependencies

### Auth0 Configuration
- [ ] Request Auth0 config update to add VS Code URI scheme
- [ ] Test VS Code URI handler in production
- [ ] Request Auth0 config to remove static port callback
- [ ] Remove local HTTP server fallback code

### Documentation
- [ ] Document new architecture for team
- [ ] Update troubleshooting guides
- [ ] Update contribution guidelines

---

## Notes

_Add implementation notes, blockers, or decisions here as work progresses._

### Branch Stack (Phases 1-4 Complete)
```
djs/vscode-lite
└── phase-1/connection-state-types - Core types, credentials, specs
    └── phase-1/connection-storage - ConnectionStorage class
        └── phase-1/connection-handler-base - Abstract ConnectionHandler
            └── phase-1/direct-connection-handler - DirectConnectionHandler
                └── phase-1/local-connection-handler - LocalConnectionHandler
                    └── phase-1/ccloud-connection-handler - CCloudConnectionHandler
                        └── phase-1/connection-manager - ConnectionManager
                            └── phase-2/oauth-types-config - OAuth types and config
                                └── phase-2/pkce-implementation - PKCE implementation
                                    └── phase-2/token-manager - TokenManager class
                                        └── phase-2/token-exchange - Token exchange functions
                                            └── phase-2/callback-server - OAuth callback server
                                                └── phase-2/uri-handler - VS Code URI handler
                                                    └── phase-2/auth-service - AuthService class
                                                        └── phase-3/http-client - HttpClient foundation
                                                            └── phase-3/kafka-rest-proxy - Kafka REST v3 proxy
                                                                └── phase-3/schema-registry-proxy - Schema Registry proxy
                                                                    └── phase-3/ccloud-control-plane-proxy - CCloud API proxy
                                                                        └── phase-3/ccloud-data-plane-proxy - Flink API proxy
                                                                            └── phase-4/resource-fetchers - Topic, schema, CCloud fetchers
                                                                                └── phase-4/local-direct-fetchers - Local & direct fetchers
                                                                                    └── phase-4/loader-integration - Loader integration ← current
```

### Test Summary (Phase 1)
- types.test.ts: 16 tests
- credentials.test.ts: 19 tests
- spec.test.ts: 12 tests
- storage.test.ts: 23 tests
- connectionHandler.test.ts: 20 tests
- directConnectionHandler.test.ts: 35 tests
- localConnectionHandler.test.ts: 24 tests
- ccloudConnectionHandler.test.ts: 29 tests
- connectionManager.test.ts: 37 tests
- **Total Phase 1 tests: 215 tests**

### Test Summary (Phase 2)
- types.test.ts: 7 tests
- config.test.ts: 6 tests
- pkce.test.ts: 12 tests
- tokenManager.test.ts: 34 tests
- tokenExchange.test.ts: 17 tests
- callbackServer.test.ts: 15 tests
- uriHandler.test.ts: 12 tests
- authService.test.ts: 28 tests
- credentialResolver.test.ts: 10 tests
- basicHandler.test.ts: 8 tests
- apiKeyHandler.test.ts: 8 tests
- scramHandler.test.ts: 6 tests
- mtlsHandler.test.ts: 6 tests
- kerberosHandler.test.ts: 6 tests
- **Total Phase 2 tests: 175 tests**

### Test Summary (Phase 3)
- httpClient.test.ts: 33 tests
- kafkaRestProxy.test.ts: 27 tests
- schemaRegistryProxy.test.ts: 38 tests
- ccloudControlPlaneProxy.test.ts: 24 tests
- ccloudDataPlaneProxy.test.ts: 26 tests
- **Total Phase 3 tests: 148 tests**

### Test Summary (Phase 4)
- types.test.ts: 6 tests
- topicFetcher.test.ts: 9 tests
- schemaFetcher.test.ts: 18 tests
- ccloudResourceFetcher.test.ts: 14 tests
- localResourceFetcher.test.ts: 14 tests
- directResourceFetcher.test.ts: 12 tests
- **Total Phase 4 tests: 73 tests**

### Cumulative Test Count
- Phase 1: 215 tests
- Phase 2: 175 tests
- Phase 3: 148 tests
- Phase 4: 73 tests
- **Total: 611 tests**

### Decisions Made
- **File naming**: Using shorter names (`types.ts`, `spec.ts`, `storage.ts`) instead of longer names (`connectionState.ts`, `connectionStorage.ts`) for consistency and brevity
- **Storage strategy**: Using SecretStorage for all connection data (not just credentials) because ConnectionSpec objects may contain embedded credentials. This simplifies the implementation and ensures all sensitive data is secured.
- **No migration needed**: Sidecar stores connection data in memory only - it's lost when the process exits. No persistent data migration is required.
- **Type guards**: Added helper functions (`isConnectedStateUsable`, `isCredentialType`, etc.) for type-safe state checking
- **Branded types**: Using branded `ConnectionId` type (`string & { readonly __brand: "ConnectionId" }`) for type safety

### Blockers
- None currently

### Open Questions
- None currently
