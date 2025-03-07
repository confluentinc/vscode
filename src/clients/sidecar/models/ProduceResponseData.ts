/* tslint:disable */
/* eslint-disable */
/**
 * Confluent ide-sidecar API
 * API for the Confluent ide-sidecar, part of Confluent for VS Code
 *
 * The version of the OpenAPI document: 0.167.0
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
 * @interface ProduceResponseData
 */
export interface ProduceResponseData {
  /**
   *
   * @type {number}
   * @memberof ProduceResponseData
   */
  size: number;
  /**
   *
   * @type {string}
   * @memberof ProduceResponseData
   */
  type: string;
  /**
   *
   * @type {string}
   * @memberof ProduceResponseData
   */
  subject?: string;
  /**
   *
   * @type {number}
   * @memberof ProduceResponseData
   */
  schema_id?: number;
  /**
   *
   * @type {number}
   * @memberof ProduceResponseData
   */
  schema_version?: number;
}

/**
 * Check if a given object implements the ProduceResponseData interface.
 */
export function instanceOfProduceResponseData(value: object): value is ProduceResponseData {
  if (!("size" in value) || value["size"] === undefined) return false;
  if (!("type" in value) || value["type"] === undefined) return false;
  return true;
}

export function ProduceResponseDataFromJSON(json: any): ProduceResponseData {
  return ProduceResponseDataFromJSONTyped(json, false);
}

export function ProduceResponseDataFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): ProduceResponseData {
  if (json == null) {
    return json;
  }
  return {
    size: json["size"],
    type: json["type"],
    subject: json["subject"] == null ? undefined : json["subject"],
    schema_id: json["schema_id"] == null ? undefined : json["schema_id"],
    schema_version: json["schema_version"] == null ? undefined : json["schema_version"],
  };
}

export function ProduceResponseDataToJSON(json: any): ProduceResponseData {
  return ProduceResponseDataToJSONTyped(json, false);
}

export function ProduceResponseDataToJSONTyped(
  value?: ProduceResponseData | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    size: value["size"],
    type: value["type"],
    subject: value["subject"],
    schema_id: value["schema_id"],
    schema_version: value["schema_version"],
  };
}
