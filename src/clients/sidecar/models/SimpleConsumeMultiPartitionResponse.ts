/* tslint:disable */
/* eslint-disable */
/**
 * Confluent ide-sidecar API
 * API for the Confluent ide-sidecar, part of Confluent for VS Code
 *
 * The version of the OpenAPI document: 0.165.0
 * Contact: vscode@confluent.io
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */

import { mapValues } from "../runtime";
import type { PartitionConsumeData } from "./PartitionConsumeData";
import {
  PartitionConsumeDataFromJSON,
  PartitionConsumeDataFromJSONTyped,
  PartitionConsumeDataToJSON,
  PartitionConsumeDataToJSONTyped,
} from "./PartitionConsumeData";

/**
 *
 * @export
 * @interface SimpleConsumeMultiPartitionResponse
 */
export interface SimpleConsumeMultiPartitionResponse {
  /**
   *
   * @type {string}
   * @memberof SimpleConsumeMultiPartitionResponse
   */
  cluster_id?: string;
  /**
   *
   * @type {string}
   * @memberof SimpleConsumeMultiPartitionResponse
   */
  topic_name?: string;
  /**
   *
   * @type {Array<PartitionConsumeData>}
   * @memberof SimpleConsumeMultiPartitionResponse
   */
  partition_data_list?: Array<PartitionConsumeData>;
}

/**
 * Check if a given object implements the SimpleConsumeMultiPartitionResponse interface.
 */
export function instanceOfSimpleConsumeMultiPartitionResponse(
  value: object,
): value is SimpleConsumeMultiPartitionResponse {
  return true;
}

export function SimpleConsumeMultiPartitionResponseFromJSON(
  json: any,
): SimpleConsumeMultiPartitionResponse {
  return SimpleConsumeMultiPartitionResponseFromJSONTyped(json, false);
}

export function SimpleConsumeMultiPartitionResponseFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): SimpleConsumeMultiPartitionResponse {
  if (json == null) {
    return json;
  }
  return {
    cluster_id: json["cluster_id"] == null ? undefined : json["cluster_id"],
    topic_name: json["topic_name"] == null ? undefined : json["topic_name"],
    partition_data_list:
      json["partition_data_list"] == null
        ? undefined
        : (json["partition_data_list"] as Array<any>).map(PartitionConsumeDataFromJSON),
  };
}

export function SimpleConsumeMultiPartitionResponseToJSON(
  json: any,
): SimpleConsumeMultiPartitionResponse {
  return SimpleConsumeMultiPartitionResponseToJSONTyped(json, false);
}

export function SimpleConsumeMultiPartitionResponseToJSONTyped(
  value?: SimpleConsumeMultiPartitionResponse | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    cluster_id: value["cluster_id"],
    topic_name: value["topic_name"],
    partition_data_list:
      value["partition_data_list"] == null
        ? undefined
        : (value["partition_data_list"] as Array<any>).map(PartitionConsumeDataToJSON),
  };
}
