/**
 * Proxy module for Confluent service API calls.
 *
 * Provides HTTP clients and proxies for:
 * - Kafka REST API v3
 * - Schema Registry API
 * - CCloud Control Plane API
 * - CCloud Data Plane API (Flink)
 */

// HTTP Client
export {
  createHttpClient,
  HttpClient,
  HttpError,
  TimeoutError,
  type AuthConfig,
  type AuthType,
  type HttpClientConfig,
  type HttpMethod,
  type HttpResponse,
  type RequestOptions,
} from "./httpClient";

// Kafka REST API v3 Proxy
export {
  createKafkaRestProxy,
  KafkaRestProxy,
  type CreateTopicOptions,
  type KafkaRestProxyConfig,
  type ListTopicsOptions,
  type ProduceRecordData,
  type ProduceRecordOptions,
  type UpdateTopicConfigOptions,
} from "./kafkaRestProxy";

// Schema Registry API Proxy
export {
  createSchemaRegistryProxy,
  SchemaRegistryProxy,
  type CompatibilityCheckOptions,
  type CompatibilityMode,
  type DeleteOptions,
  type ListSchemasOptions,
  type ListSubjectsOptions,
  type RegisterSchemaOptions,
  type SchemaReferenceInput,
  type SchemaRegistryProxyConfig,
  type SchemaType,
} from "./schemaRegistryProxy";
