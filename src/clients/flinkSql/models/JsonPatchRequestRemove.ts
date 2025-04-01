/* tslint:disable */
/* eslint-disable */
/**
 * SQL API v1
 * No description provided (generated by Openapi Generator https://github.com/openapitools/openapi-generator)
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
 * This option is used to remove a field
 * @export
 * @interface JsonPatchRequestRemove
 */
export interface JsonPatchRequestRemove {
  /**
   * A JSON Pointer path.
   * @type {string}
   * @memberof JsonPatchRequestRemove
   */
  path: string;
  /**
   * The operation to perform.
   * @type {string}
   * @memberof JsonPatchRequestRemove
   */
  op: JsonPatchRequestRemoveOpEnum;
}

/**
 * @export
 */
export const JsonPatchRequestRemoveOpEnum = {
  Remove: "REMOVE",
} as const;
export type JsonPatchRequestRemoveOpEnum =
  (typeof JsonPatchRequestRemoveOpEnum)[keyof typeof JsonPatchRequestRemoveOpEnum];

/**
 * Check if a given object implements the JsonPatchRequestRemove interface.
 */
export function instanceOfJsonPatchRequestRemove(value: object): value is JsonPatchRequestRemove {
  if (!("path" in value) || value["path"] === undefined) return false;
  if (!("op" in value) || value["op"] === undefined) return false;
  return true;
}

export function JsonPatchRequestRemoveFromJSON(json: any): JsonPatchRequestRemove {
  return JsonPatchRequestRemoveFromJSONTyped(json, false);
}

export function JsonPatchRequestRemoveFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): JsonPatchRequestRemove {
  if (json == null) {
    return json;
  }
  return {
    path: json["path"],
    op: json["op"],
  };
}

export function JsonPatchRequestRemoveToJSON(json: any): JsonPatchRequestRemove {
  return JsonPatchRequestRemoveToJSONTyped(json, false);
}

export function JsonPatchRequestRemoveToJSONTyped(
  value?: JsonPatchRequestRemove | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    path: value["path"],
    op: value["op"],
  };
}
