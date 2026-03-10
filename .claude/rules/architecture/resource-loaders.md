---
paths:
  - src/loaders/**/*
---

# Resource Loader Pattern

Abstract layer for loading resources from different connection types.

## Class Hierarchy

```
ResourceLoader (abstract base at src/loaders/resourceLoader.ts)
  └── CachingResourceLoader (intermediate abstract at src/loaders/cachingResourceLoader.ts)
      ├── CCloudResourceLoader - Confluent Cloud via OAuth
      ├── LocalResourceLoader - Local Docker-based Kafka/SR
      └── DirectResourceLoader - Direct TCP connections
```

## Key Design Points

- **CachingResourceLoader** encapsulates caching of environments, Kafka clusters, schema registries,
  and topics
- Generic types (`EnvironmentType`, `KafkaClusterType`, `SchemaRegistryType`) are defined at the
  CachingResourceLoader level
- **Registry pattern**: `ResourceLoader.getInstance(connectionId)` for lookup by connection ID
- Constructed during extension activation in `constructResourceLoaderSingletons()`
- Uses **GraphQL** to query the sidecar for resource metadata

## Adding a New Resource Type

1. Add the abstract loading method to `CachingResourceLoader`
2. Implement in each concrete loader (CCloud, Local, Direct)
3. Add caching if the resource is frequently accessed
4. Register in the singleton construction during activation
