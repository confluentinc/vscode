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
 * @interface ResourceMetadata
 */
export interface ResourceMetadata {
  /**
   *
   * @type {string}
   * @memberof ResourceMetadata
   */
  self: string;
  /**
   *
   * @type {string}
   * @memberof ResourceMetadata
   */
  resource_name?: string | null;
}

/**
 * Check if a given object implements the ResourceMetadata interface.
 */
export function instanceOfResourceMetadata(value: object): value is ResourceMetadata {
  if (!("self" in value) || value["self"] === undefined) return false;
  return true;
}

export function ResourceMetadataFromJSON(json: any): ResourceMetadata {
  return ResourceMetadataFromJSONTyped(json, false);
}

export function ResourceMetadataFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): ResourceMetadata {
  if (json == null) {
    return json;
  }
  return {
    self: json["self"],
    resource_name: json["resource_name"] == null ? undefined : json["resource_name"],
  };
}

export function ResourceMetadataToJSON(json: any): ResourceMetadata {
  return ResourceMetadataToJSONTyped(json, false);
}

export function ResourceMetadataToJSONTyped(
  value?: ResourceMetadata | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    self: value["self"],
    resource_name: value["resource_name"],
  };
}
