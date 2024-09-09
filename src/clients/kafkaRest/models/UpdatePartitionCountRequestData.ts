/* tslint:disable */
/* eslint-disable */
/**
 * REST Admin API
 * No description provided (generated by Openapi Generator https://github.com/openapitools/openapi-generator)
 *
 * The version of the OpenAPI document: 3.0.0
 *
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */

import { mapValues } from "../runtime";
/**
 *
 * @export
 * @interface UpdatePartitionCountRequestData
 */
export interface UpdatePartitionCountRequestData {
  /**
   *
   * @type {number}
   * @memberof UpdatePartitionCountRequestData
   */
  partitions_count: number;
}

/**
 * Check if a given object implements the UpdatePartitionCountRequestData interface.
 */
export function instanceOfUpdatePartitionCountRequestData(
  value: object,
): value is UpdatePartitionCountRequestData {
  if (!("partitions_count" in value) || value["partitions_count"] === undefined) return false;
  return true;
}

export function UpdatePartitionCountRequestDataFromJSON(
  json: any,
): UpdatePartitionCountRequestData {
  return UpdatePartitionCountRequestDataFromJSONTyped(json, false);
}

export function UpdatePartitionCountRequestDataFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): UpdatePartitionCountRequestData {
  if (json == null) {
    return json;
  }
  return {
    partitions_count: json["partitions_count"],
  };
}

export function UpdatePartitionCountRequestDataToJSON(
  value?: UpdatePartitionCountRequestData | null,
): any {
  if (value == null) {
    return value;
  }
  return {
    partitions_count: value["partitions_count"],
  };
}
