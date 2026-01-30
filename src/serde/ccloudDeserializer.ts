/**
 * CCloud Schema Registry Deserializer.
 *
 * Handles deserialization of messages from CCloud Kafka topics that use
 * the `__raw__` field format in REST API responses. This format contains
 * base64-encoded wire format data that needs to be decoded and deserialized
 * using the Schema Registry.
 *
 * Key features:
 * - Detects and extracts `__raw__` fields from CCloud REST responses
 * - Uses SchemaRegistryProxy with bearer token auth for schema fetching
 * - Supports Avro deserialization (primary use case)
 * - Caches schemas by ID for performance
 * - Uses error caching to avoid hammering SR on repeated failures
 */

import { Logger } from "../logging";
import {
  createSchemaRegistryProxy,
  type Schema,
  type SchemaRegistryProxy,
} from "../proxy/schemaRegistryProxy";
import { getErrorCache } from "./errorCache";
import {
  DataFormat,
  type DeserializationContext,
  type DeserializedResult,
  type SchemaRegistryDeserializerConfig,
} from "./types";

const logger = new Logger("serde.ccloudDeserializer");

/** Confluent wire format magic byte. */
const WIRE_FORMAT_MAGIC_BYTE = 0x00;

/** Minimum length for wire format messages (1 magic + 4 schema ID + at least 1 byte payload). */
const WIRE_FORMAT_MIN_LENGTH = 6;

/**
 * Checks if a value is a CCloud `__raw__` field format.
 * CCloud REST API returns `{ __raw__: "base64..." }` for messages with schemas.
 *
 * @param value The value to check.
 * @returns True if the value is a raw field object.
 */
export function isRawField(value: unknown): value is { __raw__: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "__raw__" in value &&
    typeof (value as { __raw__: unknown }).__raw__ === "string"
  );
}

/**
 * Decodes a CCloud `__raw__` field from base64 to a Buffer.
 *
 * @param rawField The raw field object containing base64 data.
 * @returns The decoded buffer.
 */
export function decodeRawField(rawField: { __raw__: string }): Buffer {
  return Buffer.from(rawField.__raw__, "base64");
}

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

  return buffer.readInt32BE(1);
}

/**
 * Extracts the payload from a Confluent wire format buffer.
 * Payload starts at byte 5 (after magic byte and schema ID).
 *
 * @param buffer Wire format buffer.
 * @returns The payload buffer.
 */
function extractPayload(buffer: Buffer): Buffer {
  return buffer.subarray(5);
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
 * @param buffer Buffer to decode.
 * @returns UTF-8 string or null if binary data.
 */
function tryDecodeUtf8(buffer: Buffer): string | null {
  try {
    const str = buffer.toString("utf-8");
    if (str.includes("\uFFFD")) {
      return null;
    }
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
 * Applies the fallback chain for non-schema messages.
 * Tries: JSON parse -> UTF-8 string -> base64 bytes
 *
 * @param buffer Buffer to deserialize.
 * @returns Deserialized result.
 */
function applyFallbackChain(buffer: Buffer): DeserializedResult {
  const jsonValue = tryParseJson(buffer);
  if (jsonValue !== null) {
    return {
      value: jsonValue,
      metadata: { dataFormat: DataFormat.JSON },
    };
  }

  const utf8Value = tryDecodeUtf8(buffer);
  if (utf8Value !== null) {
    return {
      value: utf8Value,
      metadata: { dataFormat: DataFormat.UTF8_STRING },
    };
  }

  return {
    value: buffer.toString("base64"),
    metadata: { dataFormat: DataFormat.RAW_BYTES },
  };
}

/**
 * Creates a null result for empty/null input.
 */
function createNullResult(): DeserializedResult {
  return {
    value: null,
    metadata: { dataFormat: DataFormat.RAW_BYTES },
  };
}

/**
 * Maps schema type string to DataFormat.
 */
function schemaTypeToDataFormat(schemaType: string | undefined): DataFormat {
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
 * Interface for cached Avro types from avsc.
 */
interface AvroType {
  fromBuffer(buffer: Buffer): unknown;
}

/**
 * Interface for avsc module (subset we use).
 */
interface AvscModule {
  Type: {
    forSchema(schema: unknown): AvroType;
  };
}

/**
 * CCloud record deserializer that handles `__raw__` field deserialization.
 */
export class CCloudRecordDeserializer {
  private readonly config: SchemaRegistryDeserializerConfig;
  private readonly srProxy: SchemaRegistryProxy;
  private readonly schemaCache = new Map<number, { schema: Schema; avroType?: AvroType }>();
  private avscModule: AvscModule | null = null;

  constructor(config: SchemaRegistryDeserializerConfig) {
    this.config = config;
    this.srProxy = createSchemaRegistryProxy({
      baseUrl: config.schemaRegistryUrl,
      auth: config.bearerToken
        ? { type: "bearer", token: config.bearerToken }
        : config.auth
          ? { type: "basic", username: config.auth.username, password: config.auth.password }
          : undefined,
      headers: config.headers,
    });
  }

  /**
   * Deserializes a value that may be a `__raw__` field or already-decoded value.
   *
   * @param value The value from CCloud REST API (may be __raw__ or decoded).
   * @param context Deserialization context.
   * @returns Deserialized result with value, metadata, and potential error.
   */
  async deserialize(value: unknown, context: DeserializationContext): Promise<DeserializedResult> {
    // Handle null/undefined
    if (value === null || value === undefined) {
      return createNullResult();
    }

    // If not a __raw__ field, return as-is (already decoded by CCloud)
    if (!isRawField(value)) {
      return {
        value,
        metadata: { dataFormat: DataFormat.JSON },
      };
    }

    // Decode base64 to buffer
    const buffer = decodeRawField(value);
    if (buffer.length === 0) {
      return createNullResult();
    }

    // Check for wire format
    const schemaId = context.headerSchemaId ?? extractSchemaId(buffer);
    if (schemaId === null) {
      // Not wire format, use fallback chain
      return applyFallbackChain(buffer);
    }

    // Check error cache first
    const errorCache = getErrorCache();
    const cachedError = errorCache.getError(this.config.connectionId, schemaId);
    if (cachedError) {
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
      // Get schema and deserialize
      const { schema, avroType } = await this.getSchemaWithType(schemaId);
      const payload = extractPayload(buffer);

      // Try Avro deserialization if we have an avroType (schemaType is "AVRO" or undefined)
      if (avroType) {
        const decoded = avroType.fromBuffer(payload);
        return {
          value: decoded,
          metadata: {
            schemaId,
            schemaType: "AVRO",
            dataFormat: DataFormat.AVRO,
          },
        };
      }

      // Try JSON Schema deserialization
      if (schema.schemaType === "JSON") {
        const jsonValue = tryParseJson(payload);
        if (jsonValue !== null) {
          return {
            value: jsonValue,
            metadata: {
              schemaId,
              schemaType: "JSON",
              dataFormat: DataFormat.JSON_SCHEMA,
            },
          };
        }
      }

      // For PROTOBUF or failed deserialization, return base64 with metadata
      return {
        value: payload.toString("base64"),
        metadata: {
          schemaId,
          schemaType: schema.schemaType as "AVRO" | "PROTOBUF" | "JSON" | undefined,
          dataFormat: schemaTypeToDataFormat(schema.schemaType),
        },
      };
    } catch (error) {
      const errorMessage = this.formatError(error);
      logger.warn(
        `Failed to deserialize ${context.isKey ? "key" : "value"} for topic ${context.topicName} ` +
          `with schema ID ${schemaId}: ${errorMessage}`,
      );

      // Cache the error
      errorCache.setError(this.config.connectionId, schemaId, errorMessage);

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

  /**
   * Gets the schema and creates the avsc type for deserialization.
   */
  private async getSchemaWithType(
    schemaId: number,
  ): Promise<{ schema: Schema; avroType?: AvroType }> {
    // Check cache first
    const cached = this.schemaCache.get(schemaId);
    if (cached) {
      return cached;
    }

    // Fetch schema from Schema Registry
    const schema = await this.srProxy.getSchemaById(schemaId);

    let avroType: AvroType | undefined;
    // Try to create Avro type if schemaType is "AVRO" or undefined (AVRO is the default)
    // Protobuf and JSON Schema explicitly set their types
    if ((schema.schemaType === "AVRO" || !schema.schemaType) && schema.schema) {
      // Lazy load avsc module
      if (!this.avscModule) {
        this.avscModule = await import("avsc");
      }

      try {
        // Parse the Avro schema
        const parsedSchema = JSON.parse(schema.schema);
        avroType = this.avscModule.Type.forSchema(parsedSchema);
      } catch (parseError) {
        logger.warn(`Failed to parse Avro schema ${schemaId}: ${parseError}`);
      }
    }

    const entry = { schema, avroType };
    this.schemaCache.set(schemaId, entry);
    return entry;
  }

  /**
   * Formats an error for display.
   */
  private formatError(error: unknown): string {
    if (error instanceof Error) {
      const msg = error.message;
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
      logger.debug(`Full SR error: ${msg}`);
      return msg;
    }
    return String(error);
  }

  /**
   * Clears the schema cache.
   */
  clearCache(): void {
    this.schemaCache.clear();
  }
}

/**
 * Creates a CCloud record deserializer.
 *
 * @param config Configuration for the deserializer.
 * @returns A new CCloud record deserializer instance.
 */
export function createCCloudRecordDeserializer(
  config: SchemaRegistryDeserializerConfig,
): CCloudRecordDeserializer {
  return new CCloudRecordDeserializer(config);
}
