/* tslint:disable */
/* eslint-disable */
/**
 * Flink Compute Pool Management API
 * This is the Flink Compute Pool management API.
 *
 * The version of the OpenAPI document: 0.0.1
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
 * @interface UpdateFcpmV2ComputePoolRequestAllOfSpec
 */
export interface UpdateFcpmV2ComputePoolRequestAllOfSpec {
  /**
   *
   * @type {any}
   * @memberof UpdateFcpmV2ComputePoolRequestAllOfSpec
   */
  environment: any | null;
}

/**
 * Check if a given object implements the UpdateFcpmV2ComputePoolRequestAllOfSpec interface.
 */
export function instanceOfUpdateFcpmV2ComputePoolRequestAllOfSpec(
  value: object,
): value is UpdateFcpmV2ComputePoolRequestAllOfSpec {
  if (!("environment" in value) || value["environment"] === undefined) return false;
  return true;
}

export function UpdateFcpmV2ComputePoolRequestAllOfSpecFromJSON(
  json: any,
): UpdateFcpmV2ComputePoolRequestAllOfSpec {
  return UpdateFcpmV2ComputePoolRequestAllOfSpecFromJSONTyped(json, false);
}

export function UpdateFcpmV2ComputePoolRequestAllOfSpecFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): UpdateFcpmV2ComputePoolRequestAllOfSpec {
  if (json == null) {
    return json;
  }
  return {
    environment: json["environment"],
  };
}

export function UpdateFcpmV2ComputePoolRequestAllOfSpecToJSON(
  json: any,
): UpdateFcpmV2ComputePoolRequestAllOfSpec {
  return UpdateFcpmV2ComputePoolRequestAllOfSpecToJSONTyped(json, false);
}

export function UpdateFcpmV2ComputePoolRequestAllOfSpecToJSONTyped(
  value?: UpdateFcpmV2ComputePoolRequestAllOfSpec | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    environment: value["environment"],
  };
}
