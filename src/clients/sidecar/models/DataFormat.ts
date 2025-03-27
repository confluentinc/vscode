/* tslint:disable */
/* eslint-disable */
/**
 * Confluent ide-sidecar API
 * API for the Confluent ide-sidecar, part of Confluent for VS Code
 *
 * The version of the OpenAPI document: 0.183.0
 * Contact: vscode@confluent.io
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */

/**
 * The data format that represents the bytes of a Kafka message.
 *
 * * AVRO: Apache Avro schema format.
 * * JSONSCHEMA: JSON schema format.
 * * PROTOBUF: Google Protocol Buffers schema format.
 * * JSON:
 *     Bytes parsed as JSON.
 *     The bytes did not contain a magic byte specifying a schema id, and the raw bytes
 *     were successfully parsed into a JSON value.
 * * UTF8_STRING:
 *     Bytes parsed as a UTF-8 string (meaning the bytes were not parsed as valid JSON).
 * * RAW_BYTES:
 *     Raw bytes. These are the scenarios where it would be used:
 *     - Arbitrary bytes that are NOT written/read using an implementation of Kafka serializer/deserializer.
 *     And further, we tried to but could not interpret these bytes as a JSON value.
 *     - The Kafka serializer/deserializer known to sidecar failed to parse the schematized bytes
 *     (meaning the schema id was present in the magic bytes, but our classes could not interpret the rest of the bytes.)
 *
 * @export
 */
export const DataFormat = {
  Avro: "AVRO",
  Jsonschema: "JSONSCHEMA",
  Protobuf: "PROTOBUF",
  Json: "JSON",
  Utf8String: "UTF8_STRING",
  RawBytes: "RAW_BYTES",
} as const;
export type DataFormat = (typeof DataFormat)[keyof typeof DataFormat];

export function instanceOfDataFormat(value: any): boolean {
  for (const key in DataFormat) {
    if (Object.prototype.hasOwnProperty.call(DataFormat, key)) {
      if (DataFormat[key as keyof typeof DataFormat] === value) {
        return true;
      }
    }
  }
  return false;
}

export function DataFormatFromJSON(json: any): DataFormat {
  return DataFormatFromJSONTyped(json, false);
}

export function DataFormatFromJSONTyped(json: any, ignoreDiscriminator: boolean): DataFormat {
  return json as DataFormat;
}

export function DataFormatToJSON(value?: DataFormat | null): any {
  return value as any;
}

export function DataFormatToJSONTyped(value: any, ignoreDiscriminator: boolean): DataFormat {
  return value as DataFormat;
}
