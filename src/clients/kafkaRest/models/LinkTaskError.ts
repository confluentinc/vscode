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
 * @interface LinkTaskError
 */
export interface LinkTaskError {
  /**
   *
   * @type {string}
   * @memberof LinkTaskError
   */
  error_code: string;
  /**
   *
   * @type {string}
   * @memberof LinkTaskError
   */
  error_message: string;
}

/**
 * Check if a given object implements the LinkTaskError interface.
 */
export function instanceOfLinkTaskError(value: object): value is LinkTaskError {
  if (!("error_code" in value) || value["error_code"] === undefined) return false;
  if (!("error_message" in value) || value["error_message"] === undefined) return false;
  return true;
}

export function LinkTaskErrorFromJSON(json: any): LinkTaskError {
  return LinkTaskErrorFromJSONTyped(json, false);
}

export function LinkTaskErrorFromJSONTyped(json: any, ignoreDiscriminator: boolean): LinkTaskError {
  if (json == null) {
    return json;
  }
  return {
    error_code: json["error_code"],
    error_message: json["error_message"],
  };
}

export function LinkTaskErrorToJSON(json: any): LinkTaskError {
  return LinkTaskErrorToJSONTyped(json, false);
}

export function LinkTaskErrorToJSONTyped(
  value?: LinkTaskError | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    error_code: value["error_code"],
    error_message: value["error_message"],
  };
}
