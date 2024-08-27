/* tslint:disable */
/* eslint-disable */
/**
 * Confluent ide-sidecar API
 * API for the Confluent ide-sidecar, part of the Confluent extension for VS Code
 *
 * The version of the OpenAPI document: 1.0.1
 * Contact: vscode@confluent.io
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */

import { mapValues } from "../runtime";
/**
 *
 * @export
 * @interface PartitionConsumeRecordHeader
 */
export interface PartitionConsumeRecordHeader {
  /**
   *
   * @type {string}
   * @memberof PartitionConsumeRecordHeader
   */
  key?: string;
  /**
   *
   * @type {string}
   * @memberof PartitionConsumeRecordHeader
   */
  value?: string;
}

/**
 * Check if a given object implements the PartitionConsumeRecordHeader interface.
 */
export function instanceOfPartitionConsumeRecordHeader(
  value: object,
): value is PartitionConsumeRecordHeader {
  return true;
}

export function PartitionConsumeRecordHeaderFromJSON(json: any): PartitionConsumeRecordHeader {
  return PartitionConsumeRecordHeaderFromJSONTyped(json, false);
}

export function PartitionConsumeRecordHeaderFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): PartitionConsumeRecordHeader {
  if (json == null) {
    return json;
  }
  return {
    key: json["key"] == null ? undefined : json["key"],
    value: json["value"] == null ? undefined : json["value"],
  };
}

export function PartitionConsumeRecordHeaderToJSON(
  value?: PartitionConsumeRecordHeader | null,
): any {
  if (value == null) {
    return value;
  }
  return {
    key: value["key"],
    value: value["value"],
  };
}
