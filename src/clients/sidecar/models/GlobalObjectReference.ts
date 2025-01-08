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
 * @interface GlobalObjectReference
 */
export interface GlobalObjectReference {
  /**
   *
   * @type {string}
   * @memberof GlobalObjectReference
   */
  id: string;
  /**
   *
   * @type {string}
   * @memberof GlobalObjectReference
   */
  related?: string;
  /**
   *
   * @type {string}
   * @memberof GlobalObjectReference
   */
  resource_name?: string;
}

/**
 * Check if a given object implements the GlobalObjectReference interface.
 */
export function instanceOfGlobalObjectReference(value: object): value is GlobalObjectReference {
  if (!("id" in value) || value["id"] === undefined) return false;
  return true;
}

export function GlobalObjectReferenceFromJSON(json: any): GlobalObjectReference {
  return GlobalObjectReferenceFromJSONTyped(json, false);
}

export function GlobalObjectReferenceFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): GlobalObjectReference {
  if (json == null) {
    return json;
  }
  return {
    id: json["id"],
    related: json["related"] == null ? undefined : json["related"],
    resource_name: json["resource_name"] == null ? undefined : json["resource_name"],
  };
}

export function GlobalObjectReferenceToJSON(json: any): GlobalObjectReference {
  return GlobalObjectReferenceToJSONTyped(json, false);
}

export function GlobalObjectReferenceToJSONTyped(
  value?: GlobalObjectReference | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    id: value["id"],
    related: value["related"],
    resource_name: value["resource_name"],
  };
}