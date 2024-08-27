# Sidecar OpenAPI Specs

The following OpenAPI specs are supported by the sidecar.

- The [sidecar.openapi.yaml](./sidecar.openapi.yaml) consists of explicitly documented APIs
  published in the [ide-sidecar](https://github.com/confluentinc/ide-sidecar) repository at the path
  linked below.
- The sidecar also supports the API paths specified in
  [ce-kafka-rest.openapi.yaml](./ce-kafka-rest.openapi.yaml) and
  [schema-registry.openapi.yaml](./schema-registry.openapi.yaml), to varying degrees. These specs
  are NOT managed/published by ide-sidecar itself.

| OpenAPI Spec                                                   | Source                                                                                     | Paths Supported by Sidecar (at http://localhost:26636) |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| [sidecar.openapi.yaml](./sidecar.openapi.yaml)                 | https://github.com/confluentinc/ide-sidecar/blob/main/src/generated/resources/openapi.yaml | All paths                                              |
| [ce-kafka-rest.openapi.yaml](./ce-kafka-rest.openapi.yaml)     |                                                                                            | All paths (`/kafka/v3/clusters*`)                      |
| [schema-registry.openapi.yaml](./schema-registry.openapi.yaml) |                                                                                            | Only paths under `/schemas*`, `/subjects*`             |
