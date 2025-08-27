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


We carry patches for some documents, where the upstream document doesn't describe the APIs full behavior, but we need
said behavior. We carry the patches so that when we update the base document, we can easily reapply our needs
(or discover that the upstream documents have been improved and we no longer need to patch on our side).

| OpenAPI Spec | Patch | Reason |
| ------------ | ----- | ------ |
| [ce-kafka-rest.openapi.yaml](./ce-kafka-rest.openapi.yaml) | [add_included_operations_to_list_topics_route.patch](./add_included_operations_to_list_topics_route.patch) | Expose the `includeAuthorizedOperations` parameter for the list topics route |
