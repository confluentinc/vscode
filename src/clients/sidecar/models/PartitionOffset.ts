/* tslint:disable */
/* eslint-disable */
/**
 * Confluent ide-sidecar API
 * API for the Confluent ide-sidecar, part of Confluent for VS Code
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
 * @interface PartitionOffset
 */
export interface PartitionOffset {
  /**
   *
   * @type {number}
   * @memberof PartitionOffset
   */
  partition_id?: number;
  /**
   *
   * @type {number}
   * @memberof PartitionOffset
   */
  offset?: number;
}

/**
 * Check if a given object implements the PartitionOffset interface.
 */
export function instanceOfPartitionOffset(value: object): value is PartitionOffset {
  return true;
}

export function PartitionOffsetFromJSON(json: any): PartitionOffset {
  return PartitionOffsetFromJSONTyped(json, false);
}

export function PartitionOffsetFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): PartitionOffset {
  if (json == null) {
    return json;
  }
  return {
    partition_id: json["partition_id"] == null ? undefined : json["partition_id"],
    offset: json["offset"] == null ? undefined : json["offset"],
  };
}

export function PartitionOffsetToJSON(json: any): PartitionOffset {
  return PartitionOffsetToJSONTyped(json, false);
}

export function PartitionOffsetToJSONTyped(
  value?: PartitionOffset | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    partition_id: value["partition_id"],
    offset: value["offset"],
  };
}
