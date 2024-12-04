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
 * @interface ProduceRequestHeader
 */
export interface ProduceRequestHeader {
  /**
   *
   * @type {string}
   * @memberof ProduceRequestHeader
   */
  name?: string;
  /**
   *
   * @type {string}
   * @memberof ProduceRequestHeader
   */
  key?: string;
  /**
   *
   * @type {string}
   * @memberof ProduceRequestHeader
   */
  value?: string | null;
}

/**
 * Check if a given object implements the ProduceRequestHeader interface.
 */
export function instanceOfProduceRequestHeader(value: object): value is ProduceRequestHeader {
  if (!("name" in value) || value["name"] === undefined) return false;
  return true;
}

export function ProduceRequestHeaderFromJSON(json: any): ProduceRequestHeader {
  return ProduceRequestHeaderFromJSONTyped(json, false);
}

export function ProduceRequestHeaderFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): ProduceRequestHeader {
  if (json == null) {
    return json;
  }
  return {
    name: json["name"],
    value: json["value"] == null ? undefined : json["value"],
  };
}

export function ProduceRequestHeaderToJSON(value?: ProduceRequestHeader | null): any {
  if (value == null) {
    return value;
  }
  return {
    name: value["name"],
    value: value["value"],
  };
}
