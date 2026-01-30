/**
 * Schema Registry serialization/deserialization module.
 *
 * Provides message deserialization using Confluent Schema Registry
 * for LOCAL and DIRECT connections in desktop environments, and
 * CCloud connections via REST API.
 */

export {
  createSchemaRegistryDeserializer,
  createFallbackDeserializer,
} from "./schemaRegistryDeserializer";

export {
  createCCloudRecordDeserializer,
  CCloudRecordDeserializer,
  isRawField,
  decodeRawField,
} from "./ccloudDeserializer";

export { getErrorCache, resetErrorCache } from "./errorCache";

export { DataFormat } from "./types";

export type {
  DeserializedResult,
  DeserializedMetadata,
  DeserializationContext,
  RecordDeserializer,
  SchemaRegistryDeserializerConfig,
} from "./types";
