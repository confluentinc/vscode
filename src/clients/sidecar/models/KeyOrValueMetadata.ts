/* tslint:disable */
/* eslint-disable */
/**
 * Confluent ide-sidecar API
 * API for the Confluent ide-sidecar, part of Confluent for VS Code
 *
 * The version of the OpenAPI document: 0.168.0
 * Contact: vscode@confluent.io
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */

import { mapValues } from "../runtime";
import type { DataFormat } from "./DataFormat";
import {
  DataFormatFromJSON,
  DataFormatFromJSONTyped,
  DataFormatToJSON,
  DataFormatToJSONTyped,
} from "./DataFormat";

/**
 *
 * @export
 * @interface KeyOrValueMetadata
 */
export interface KeyOrValueMetadata {
  /**
   *
   * @type {number}
   * @memberof KeyOrValueMetadata
   */
  schema_id?: number;
  /**
   *
   * @type {DataFormat}
   * @memberof KeyOrValueMetadata
   */
  data_format?: DataFormat;
}

/**
 * Check if a given object implements the KeyOrValueMetadata interface.
 */
export function instanceOfKeyOrValueMetadata(value: object): value is KeyOrValueMetadata {
  return true;
}

export function KeyOrValueMetadataFromJSON(json: any): KeyOrValueMetadata {
  return KeyOrValueMetadataFromJSONTyped(json, false);
}

export function KeyOrValueMetadataFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): KeyOrValueMetadata {
  if (json == null) {
    return json;
  }
  return {
    schema_id: json["schema_id"] == null ? undefined : json["schema_id"],
    data_format: json["data_format"] == null ? undefined : DataFormatFromJSON(json["data_format"]),
  };
}

export function KeyOrValueMetadataToJSON(json: any): KeyOrValueMetadata {
  return KeyOrValueMetadataToJSONTyped(json, false);
}

export function KeyOrValueMetadataToJSONTyped(
  value?: KeyOrValueMetadata | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    schema_id: value["schema_id"],
    data_format: DataFormatToJSON(value["data_format"]),
  };
}
