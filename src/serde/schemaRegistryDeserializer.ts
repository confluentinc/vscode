/**
 * Schema Registry Deserializer.
 *
 * Wraps @kafkajs/confluent-schema-registry to deserialize Kafka messages
 * that use Confluent wire format (magic byte + schema ID + payload).
 *
 * Handles:
 * - Wire format detection and schema-based deserialization
 * - Error caching to avoid hammering SR on repeated failures
 * - Fallback chain for non-wire-format messages (JSON → UTF-8 → base64)
 */

import { Logger } from "../logging";
import { getErrorCache } from "./errorCache";
import {
  DataFormat,
  type DeserializationContext,
  type DeserializedResult,
  type RecordDeserializer,
  type SchemaRegistryDeserializerConfig,
} from "./types";

const logger = new Logger("serde.schemaRegistryDeserializer");

/** Confluent wire format magic byte. */
const WIRE_FORMAT_MAGIC_BYTE = 0x00;

/** Minimum length for wire format messages (1 magic + 4 schema ID + at least 1 byte payload). */
const WIRE_FORMAT_MIN_LENGTH = 6;

/**
 * Extracts the schema ID from a Confluent wire format buffer.
 * Wire format: [0x00] [schema_id: 4 bytes big-endian] [payload]
 *
 * @param buffer Buffer to extract from.
 * @returns Schema ID or null if not wire format.
 */
function extractSchemaId(buffer: Buffer): number | null {
  if (buffer.length < WIRE_FORMAT_MIN_LENGTH) {
    return null;
  }

  if (buffer[0] !== WIRE_FORMAT_MAGIC_BYTE) {
    return null;
  }

  // Schema ID is bytes 1-4, big-endian
  return buffer.readInt32BE(1);
}

/**
 * Tries to parse a buffer as JSON.
 * @param buffer Buffer to parse.
 * @returns Parsed JSON value or null if invalid JSON.
 */
function tryParseJson(buffer: Buffer): unknown | null {
  try {
    const str = buffer.toString("utf-8");
    return JSON.parse(str);
  } catch {
    return null;
  }
}

/**
 * Tries to decode a buffer as UTF-8 string.
 * Returns the string if it appears to be valid UTF-8 text.
 * @param buffer Buffer to decode.
 * @returns UTF-8 string or null if binary data.
 */
function tryDecodeUtf8(buffer: Buffer): string | null {
  try {
    const str = buffer.toString("utf-8");
    // Check for replacement character which indicates invalid UTF-8
    if (str.includes("\uFFFD")) {
      return null;
    }
    // Check for null bytes or other control characters (except newline, tab, carriage return)
    // that would indicate binary data
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
        return null;
      }
    }
    return str;
  } catch {
    return null;
  }
}

/**
 * Converts buffer to base64 for raw bytes representation.
 * @param buffer Buffer to convert.
 * @returns Base64 encoded string.
 */
function toBase64(buffer: Buffer): string {
  return buffer.toString("base64");
}

/**
 * Creates a deserialized result for null/empty input.
 */
function createNullResult(): DeserializedResult {
  return {
    value: null,
    metadata: {
      dataFormat: DataFormat.RAW_BYTES,
    },
  };
}

/**
 * Applies the fallback chain for non-wire-format messages.
 * Tries: JSON parse → UTF-8 string → base64 bytes
 *
 * @param buffer Buffer to deserialize.
 * @returns Deserialized result.
 */
function applyFallbackChain(buffer: Buffer): DeserializedResult {
  // Try JSON first
  const jsonValue = tryParseJson(buffer);
  if (jsonValue !== null) {
    return {
      value: jsonValue,
      metadata: {
        dataFormat: DataFormat.JSON,
      },
    };
  }

  // Try UTF-8 string
  const utf8Value = tryDecodeUtf8(buffer);
  if (utf8Value !== null) {
    return {
      value: utf8Value,
      metadata: {
        dataFormat: DataFormat.UTF8_STRING,
      },
    };
  }

  // Fall back to base64
  return {
    value: toBase64(buffer),
    metadata: {
      dataFormat: DataFormat.RAW_BYTES,
    },
  };
}

/**
 * Maps SchemaType enum to our DataFormat enum.
 */
function schemaTypeToDataFormat(schemaType: string): DataFormat {
  switch (schemaType) {
    case "AVRO":
      return DataFormat.AVRO;
    case "PROTOBUF":
      return DataFormat.PROTOBUF;
    case "JSON":
      return DataFormat.JSON_SCHEMA;
    default:
      return DataFormat.RAW_BYTES;
  }
}

/**
 * SchemaRegistry instance type.
 * We use a simplified type here to avoid import() type annotation lint warnings.
 */
interface SchemaRegistryLike {
  decode(buffer: Buffer): Promise<unknown>;
  getSchema(registryId: number): Promise<unknown>;
}

/**
 * Schema Registry deserializer implementation.
 */
class SchemaRegistryDeserializerImpl implements RecordDeserializer {
  private registry: SchemaRegistryLike | null = null;
  private readonly config: SchemaRegistryDeserializerConfig;

  constructor(config: SchemaRegistryDeserializerConfig) {
    this.config = config;
  }

  async deserialize(
    buffer: Buffer | null,
    context: DeserializationContext,
  ): Promise<DeserializedResult> {
    // Handle null/empty buffer
    if (!buffer || buffer.length === 0) {
      return createNullResult();
    }

    // Check for wire format
    const schemaId = extractSchemaId(buffer);
    if (schemaId === null) {
      // Not wire format, use fallback chain
      return applyFallbackChain(buffer);
    }

    // Check error cache first
    const errorCache = getErrorCache();
    const cachedError = errorCache.getError(this.config.connectionId, schemaId);
    if (cachedError) {
      // Silently return cached error - already logged when first encountered
      return {
        ...applyFallbackChain(buffer),
        errorMessage: cachedError,
        metadata: {
          schemaId,
          dataFormat: DataFormat.RAW_BYTES,
        },
      };
    }

    try {
      // Ensure registry is initialized
      if (!this.registry) {
        await this.initializeRegistry();
      }

      // Decode using Schema Registry
      const decoded = await this.registry!.decode(buffer);

      // Get schema info for metadata
      const schema = await this.registry!.getSchema(schemaId);
      const schemaType = this.getSchemaType(schema);

      return {
        value: decoded,
        metadata: {
          schemaId,
          schemaType,
          dataFormat: schemaTypeToDataFormat(schemaType ?? ""),
        },
      };
    } catch (error) {
      const errorMessage = this.formatError(error);
      logger.warn(
        `Failed to deserialize ${context.isKey ? "key" : "value"} for topic ${context.topicName} ` +
          `with schema ID ${schemaId}: ${errorMessage}`,
      );

      // Cache the error to avoid hammering SR
      errorCache.setError(this.config.connectionId, schemaId, errorMessage);

      // Return fallback with error message
      return {
        ...applyFallbackChain(buffer),
        errorMessage,
        metadata: {
          schemaId,
          dataFormat: DataFormat.RAW_BYTES,
        },
      };
    }
  }

  private async initializeRegistry(): Promise<void> {
    // Dynamic import to avoid loading in web environment
    const { SchemaRegistry } = await import("@kafkajs/confluent-schema-registry");

    const options: ConstructorParameters<typeof SchemaRegistry>[0] = {
      host: this.config.schemaRegistryUrl,
    };

    if (this.config.auth) {
      options.auth = {
        username: this.config.auth.username,
        password: this.config.auth.password,
      };
      logger.debug(
        `Initializing Schema Registry client for ${this.config.schemaRegistryUrl} with auth`,
      );
    } else {
      logger.debug(
        `Initializing Schema Registry client for ${this.config.schemaRegistryUrl} without auth`,
      );
    }

    this.registry = new SchemaRegistry(options);
  }

  private getSchemaType(schema: unknown): "AVRO" | "PROTOBUF" | "JSON" | undefined {
    // The schema object from getSchema has different shapes depending on type
    // For Avro, it's an avsc Type object with a 'type' property
    // For Protobuf and JSON, the structure is different
    if (!schema || typeof schema !== "object") {
      return undefined;
    }

    // Check if it looks like an Avro schema (has avsc Type properties)
    const schemaObj = schema as Record<string, unknown>;
    if ("type" in schemaObj && typeof schemaObj.type === "string") {
      // Could be avro record type
      if (schemaObj.type === "record" || schemaObj.type === "enum" || schemaObj.type === "fixed") {
        return "AVRO";
      }
    }

    // Check for fromBuffer method which Avro schemas have
    if ("fromBuffer" in schemaObj && typeof schemaObj.fromBuffer === "function") {
      return "AVRO";
    }

    // Default to undefined if we can't determine
    return undefined;
  }

  private formatError(error: unknown): string {
    if (error instanceof Error) {
      const msg = error.message;
      // Clean up common error messages
      if (msg.includes("404")) {
        return "Schema not found in Schema Registry";
      }
      if (msg.includes("401")) {
        return "Authentication failed - check Schema Registry credentials";
      }
      if (msg.includes("403")) {
        return "Not authorized to access schema - check permissions";
      }
      if (msg.includes("ECONNREFUSED") || msg.includes("ETIMEDOUT")) {
        return `Cannot connect to Schema Registry at ${this.config.schemaRegistryUrl}`;
      }
      if (msg.includes("ENOTFOUND")) {
        return `Schema Registry host not found: ${this.config.schemaRegistryUrl}`;
      }
      // Log full error for debugging
      logger.debug(`Full SR error: ${msg}`);
      return msg;
    }
    return String(error);
  }
}

/**
 * Creates a Schema Registry deserializer.
 *
 * @param config Configuration for the deserializer.
 * @returns A RecordDeserializer instance.
 */
export function createSchemaRegistryDeserializer(
  config: SchemaRegistryDeserializerConfig,
): RecordDeserializer {
  return new SchemaRegistryDeserializerImpl(config);
}

/**
 * Creates a simple deserializer that only uses the fallback chain (no SR).
 * Used when Schema Registry is not available.
 */
export function createFallbackDeserializer(): RecordDeserializer {
  return {
    async deserialize(buffer: Buffer | null): Promise<DeserializedResult> {
      if (!buffer || buffer.length === 0) {
        return createNullResult();
      }
      return applyFallbackChain(buffer);
    },
  };
}
