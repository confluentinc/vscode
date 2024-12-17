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
import type { BrokerReplicaExclusionRequestData } from "./BrokerReplicaExclusionRequestData";
import {
  BrokerReplicaExclusionRequestDataFromJSON,
  BrokerReplicaExclusionRequestDataFromJSONTyped,
  BrokerReplicaExclusionRequestDataToJSON,
  BrokerReplicaExclusionRequestDataToJSONTyped,
} from "./BrokerReplicaExclusionRequestData";

/**
 *
 * @export
 * @interface BrokerReplicaExclusionBatchRequestData
 */
export interface BrokerReplicaExclusionBatchRequestData {
  /**
   *
   * @type {Array<BrokerReplicaExclusionRequestData>}
   * @memberof BrokerReplicaExclusionBatchRequestData
   */
  data: Array<BrokerReplicaExclusionRequestData>;
}

/**
 * Check if a given object implements the BrokerReplicaExclusionBatchRequestData interface.
 */
export function instanceOfBrokerReplicaExclusionBatchRequestData(
  value: object,
): value is BrokerReplicaExclusionBatchRequestData {
  if (!("data" in value) || value["data"] === undefined) return false;
  return true;
}

export function BrokerReplicaExclusionBatchRequestDataFromJSON(
  json: any,
): BrokerReplicaExclusionBatchRequestData {
  return BrokerReplicaExclusionBatchRequestDataFromJSONTyped(json, false);
}

export function BrokerReplicaExclusionBatchRequestDataFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): BrokerReplicaExclusionBatchRequestData {
  if (json == null) {
    return json;
  }
  return {
    data: (json["data"] as Array<any>).map(BrokerReplicaExclusionRequestDataFromJSON),
  };
}

export function BrokerReplicaExclusionBatchRequestDataToJSON(
  json: any,
): BrokerReplicaExclusionBatchRequestData {
  return BrokerReplicaExclusionBatchRequestDataToJSONTyped(json, false);
}

export function BrokerReplicaExclusionBatchRequestDataToJSONTyped(
  value?: BrokerReplicaExclusionBatchRequestData | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    data: (value["data"] as Array<any>).map(BrokerReplicaExclusionRequestDataToJSON),
  };
}
