/**
 * Types for message serialization/deserialization.
 *
 * Defines the interfaces and enums used by the Schema Registry
 * deserializer for handling Kafka message payloads.
 */

/**
 * Data format types for message payloads.
 *
 * AVRO, PROTOBUF, JSON_SCHEMA use Schema Registry wire format.
 * JSON, UTF8_STRING, RAW_BYTES are fallback formats.
 */
export enum DataFormat {
  /** Avro serialized with Schema Registry wire format */
  AVRO = "AVRO",
  /** Protobuf serialized with Schema Registry wire format */
  PROTOBUF = "PROTOBUF",
  /** JSON Schema serialized with Schema Registry wire format */
  JSON_SCHEMA = "JSON_SCHEMA",
  /** Plain JSON (no wire format) */
  JSON = "JSON",
  /** UTF-8 encoded string */
  UTF8_STRING = "UTF8_STRING",
  /** Raw bytes (base64 encoded in JSON) */
  RAW_BYTES = "RAW_BYTES",
}

/**
 * Metadata about a deserialized message.
 */
export interface DeserializedMetadata {
  /** Schema ID from wire format header (bytes 1-4). */
  schemaId?: number;
  /** Schema type (AVRO, PROTOBUF, JSON). */
  schemaType?: "AVRO" | "PROTOBUF" | "JSON";
  /** Data format used for deserialization. */
  dataFormat: DataFormat;
}

/**
 * Result of deserializing a message key or value.
 */
export interface DeserializedResult {
  /** Deserialized value (object, string, or base64 encoded bytes). */
  value: unknown;
  /** Error message if deserialization failed. */
  errorMessage?: string;
  /** Metadata about the deserialization process. */
  metadata: DeserializedMetadata;
}

/**
 * Configuration for creating a Schema Registry deserializer.
 */
export interface SchemaRegistryDeserializerConfig {
  /** Schema Registry URL. */
  schemaRegistryUrl: string;
  /** Authentication configuration. */
  auth?: {
    username: string;
    password: string;
  };
  /** Connection ID for error caching. */
  connectionId: string;
  /** Cluster ID for logging. */
  clusterId: string;
}

/**
 * Context for deserialization.
 */
export interface DeserializationContext {
  /** Topic name. */
  topicName: string;
  /** Whether this is a key (true) or value (false). */
  isKey: boolean;
}

/**
 * Interface for deserializing Kafka messages.
 */
export interface RecordDeserializer {
  /**
   * Deserializes a buffer using Schema Registry or fallback methods.
   * @param buffer The raw message buffer to deserialize.
   * @param context Context about the message (topic, isKey).
   * @returns Deserialized result with value, error, and metadata.
   */
  deserialize(buffer: Buffer | null, context: DeserializationContext): Promise<DeserializedResult>;
}
