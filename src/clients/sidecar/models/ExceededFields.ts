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

import { mapValues } from "../runtime";
/**
 *
 * @export
 * @interface ExceededFields
 */
export interface ExceededFields {
  /**
   *
   * @type {boolean}
   * @memberof ExceededFields
   */
  key?: boolean;
  /**
   *
   * @type {boolean}
   * @memberof ExceededFields
   */
  value?: boolean;
}

/**
 * Check if a given object implements the ExceededFields interface.
 */
export function instanceOfExceededFields(value: object): value is ExceededFields {
  return true;
}

export function ExceededFieldsFromJSON(json: any): ExceededFields {
  return ExceededFieldsFromJSONTyped(json, false);
}

export function ExceededFieldsFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): ExceededFields {
  if (json == null) {
    return json;
  }
  return {
    key: json["key"] == null ? undefined : json["key"],
    value: json["value"] == null ? undefined : json["value"],
  };
}

export function ExceededFieldsToJSON(json: any): ExceededFields {
  return ExceededFieldsToJSONTyped(json, false);
}

export function ExceededFieldsToJSONTyped(
  value?: ExceededFields | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    key: value["key"],
    value: value["value"],
  };
}
