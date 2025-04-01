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
 * This option is used to move or copy a field
 * @export
 * @interface JsonPatchRequestMoveCopy
 */
export interface JsonPatchRequestMoveCopy {
  /**
   * A JSON Pointer path.
   * @type {string}
   * @memberof JsonPatchRequestMoveCopy
   */
  path: string;
  /**
   * The operation to perform.
   * @type {string}
   * @memberof JsonPatchRequestMoveCopy
   */
  op: JsonPatchRequestMoveCopyOpEnum;
  /**
   * A JSON Pointer path.
   * @type {string}
   * @memberof JsonPatchRequestMoveCopy
   */
  from: string;
}

/**
 * @export
 * @enum {string}
 */
export enum JsonPatchRequestMoveCopyOpEnum {
  Move = "MOVE",
  Copy = "COPY",
}

/**
 * Check if a given object implements the JsonPatchRequestMoveCopy interface.
 */
export function instanceOfJsonPatchRequestMoveCopy(
  value: object,
): value is JsonPatchRequestMoveCopy {
  if (!("path" in value) || value["path"] === undefined) return false;
  if (!("op" in value) || value["op"] === undefined) return false;
  if (!("from" in value) || value["from"] === undefined) return false;
  return true;
}

export function JsonPatchRequestMoveCopyFromJSON(json: any): JsonPatchRequestMoveCopy {
  return JsonPatchRequestMoveCopyFromJSONTyped(json, false);
}

export function JsonPatchRequestMoveCopyFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): JsonPatchRequestMoveCopy {
  if (json == null) {
    return json;
  }
  return {
    path: json["path"],
    op: json["op"],
    from: json["from"],
  };
}

export function JsonPatchRequestMoveCopyToJSON(json: any): JsonPatchRequestMoveCopy {
  return JsonPatchRequestMoveCopyToJSONTyped(json, false);
}

export function JsonPatchRequestMoveCopyToJSONTyped(
  value?: JsonPatchRequestMoveCopy | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    path: value["path"],
    op: value["op"],
    from: value["from"],
  };
}
