/**
 * Resource Fetchers Module.
 *
 * Provides fetchers for loading resources from different connection types.
 * These fetchers replace GraphQL queries to the sidecar during migration.
 */

// Types
export {
  type TopicData,
  type TopicFetcher,
  type SchemaFetcher,
  TopicFetchError,
  SchemaFetchError,
} from "./types";

// Topic Fetcher
export { createTopicFetcher, type TopicFetcherConfig } from "./topicFetcher";

// Schema Fetcher
export { createSchemaFetcher, type SchemaFetcherConfig } from "./schemaFetcher";

// CCloud Resource Fetcher
export {
  createCCloudResourceFetcher,
  type CCloudResourceFetcher,
  type CCloudResourceFetcherConfig,
  CCLOUD_CONNECTION_ID,
} from "./ccloudResourceFetcher";
