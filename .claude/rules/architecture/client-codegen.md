---
paths:
  - src/clients/**/*
  - src/graphql/**/*
---

# Client Code Generation

**NEVER manually edit files in `src/clients/`** — all auto-generated from OpenAPI specs.

## OpenAPI (REST) Clients

To modify client code:

1. Update the OpenAPI spec in `src/clients/sidecar-openapi-specs/`
2. Run `npx gulp apigen`
3. Commit both the spec changes AND a `.patch` file to `src/clients/sidecar-openapi-specs/patches/`
   so subsequent generations apply cleanly

## GraphQL

- Uses `gql.tada` for type-safe queries
- Schema at `src/graphql/sidecar.graphql`
- Generated types at `src/graphql/sidecarGraphQL.d.ts` (auto-generated, do not edit)
- Query definitions live alongside the code that uses them

## Auto-Generated Directories and Files (never edit)

- `src/clients/sidecar/`
- `src/clients/schemaRegistryRest/`
- `src/clients/kafkaRest/`
- `src/clients/docker/`
- `src/clients/flinkSql/`
- `src/clients/flinkComputePool/`
- `src/clients/flinkArtifacts/`
- `src/clients/flinkWorkspaces/`
- `src/clients/scaffoldingService/`
- `src/clients/medusa/`
- `src/graphql/sidecarGraphQL.d.ts`
