---
paths:
  - src/authn/**/*
  - src/authz/**/*
  - src/directConnect*
  - src/directConnections/**/*
---

# Connection Types

The extension supports three connection types, each with different resource loading strategies.

## CCLOUD (Confluent Cloud)

- Uses `CCloudResourceLoader` with GraphQL queries to the sidecar
- OAuth authentication: sign-in/sign-out actions manage tokens
- Access to Environments, Kafka clusters, Schema registries, Flink resources
- Auth flows in `src/authn/`

## LOCAL (Docker-based)

- Uses `LocalResourceLoader` with Docker engine API
- Automatically detects local Kafka/SR containers
- No authentication required
- Docker integration in `src/docker/`

## DIRECT (TCP connections)

- Uses `DirectResourceLoader` with manual connection configuration
- Supports custom brokers and schema registry URLs
- Optional SASL authentication
- Configuration UI via webview form (`src/webview/direct-connect-form.*`)
- Connection management in `src/directConnect*` and `src/directConnections/`

Each connection type has its own ResourceLoader implementation managing the specific connection
details and API calls. See the resource-loaders rule for the class hierarchy.
