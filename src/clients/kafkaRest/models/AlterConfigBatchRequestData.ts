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
import type { AlterConfigBatchRequestDataDataInner } from "./AlterConfigBatchRequestDataDataInner";
import {
  AlterConfigBatchRequestDataDataInnerFromJSON,
  AlterConfigBatchRequestDataDataInnerFromJSONTyped,
  AlterConfigBatchRequestDataDataInnerToJSON,
  AlterConfigBatchRequestDataDataInnerToJSONTyped,
} from "./AlterConfigBatchRequestDataDataInner";

/**
 *
 * @export
 * @interface AlterConfigBatchRequestData
 */
export interface AlterConfigBatchRequestData {
  /**
   *
   * @type {Array<AlterConfigBatchRequestDataDataInner>}
   * @memberof AlterConfigBatchRequestData
   */
  data: Array<AlterConfigBatchRequestDataDataInner>;
  /**
   *
   * @type {boolean}
   * @memberof AlterConfigBatchRequestData
   */
  validate_only?: boolean;
}

/**
 * Check if a given object implements the AlterConfigBatchRequestData interface.
 */
export function instanceOfAlterConfigBatchRequestData(
  value: object,
): value is AlterConfigBatchRequestData {
  if (!("data" in value) || value["data"] === undefined) return false;
  return true;
}

export function AlterConfigBatchRequestDataFromJSON(json: any): AlterConfigBatchRequestData {
  return AlterConfigBatchRequestDataFromJSONTyped(json, false);
}

export function AlterConfigBatchRequestDataFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): AlterConfigBatchRequestData {
  if (json == null) {
    return json;
  }
  return {
    data: (json["data"] as Array<any>).map(AlterConfigBatchRequestDataDataInnerFromJSON),
    validate_only: json["validate_only"] == null ? undefined : json["validate_only"],
  };
}

export function AlterConfigBatchRequestDataToJSON(json: any): AlterConfigBatchRequestData {
  return AlterConfigBatchRequestDataToJSONTyped(json, false);
}

export function AlterConfigBatchRequestDataToJSONTyped(
  value?: AlterConfigBatchRequestData | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    data: (value["data"] as Array<any>).map(AlterConfigBatchRequestDataDataInnerToJSON),
    validate_only: value["validate_only"],
  };
}
