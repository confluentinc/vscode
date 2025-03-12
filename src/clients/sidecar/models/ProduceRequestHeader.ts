/* tslint:disable */
/* eslint-disable */
/**
 * Confluent ide-sidecar API
 * API for the Confluent ide-sidecar, part of Confluent for VS Code
 *
 * The version of the OpenAPI document: 0.173.0
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
 * @interface ProduceRequestHeader
 */
export interface ProduceRequestHeader {
  /**
   *
   * @type {string}
   * @memberof ProduceRequestHeader
   */
  name: string;
  /**
   *
   * @type {Blob}
   * @memberof ProduceRequestHeader
   */
  value?: Blob;
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

export function ProduceRequestHeaderToJSON(json: any): ProduceRequestHeader {
  return ProduceRequestHeaderToJSONTyped(json, false);
}

export function ProduceRequestHeaderToJSONTyped(
  value?: ProduceRequestHeader | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    name: value["name"],
    value: value["value"],
  };
}
