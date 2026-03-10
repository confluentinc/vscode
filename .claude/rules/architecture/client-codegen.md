---
paths:
  - src/clients/**/*
  - src/graphql/**/*
---

# Client Code Generation

**NEVER manually edit generated client code** under the auto-generated directories listed below.
These clients are produced from OpenAPI specs and should only be changed via spec/patch updates and
regeneration.

## OpenAPI (REST) Clients

OpenAPI specs typically come from upstream services — don't edit them directly. To adjust generated
output, add a `.patch` file to `src/clients/sidecar-openapi-specs/patches/` (applied automatically
during `npx gulp apigen`).

To regenerate clients after spec or patch changes:

1. Run `npx gulp apigen`
2. Commit both any new/updated spec files AND corresponding `.patch` files

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
