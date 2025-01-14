/* tslint:disable */
/* eslint-disable */
/**
 * Scaffolding API
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
 * ObjectReference provides information for you to locate the referred object
 * @export
 * @interface GlobalObjectReference
 */
export interface GlobalObjectReference {
  /**
   * ID of the referred resource
   * @type {string}
   * @memberof GlobalObjectReference
   */
  id: string;
  /**
   * API URL for accessing or modifying the referred object
   * @type {string}
   * @memberof GlobalObjectReference
   */
  readonly related: string;
  /**
   * CRN reference to the referred resource
   * @type {string}
   * @memberof GlobalObjectReference
   */
  readonly resource_name: string;
}

/**
 * Check if a given object implements the GlobalObjectReference interface.
 */
export function instanceOfGlobalObjectReference(value: object): value is GlobalObjectReference {
  if (!("id" in value) || value["id"] === undefined) return false;
  if (!("related" in value) || value["related"] === undefined) return false;
  if (!("resource_name" in value) || value["resource_name"] === undefined) return false;
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
    related: json["related"],
    resource_name: json["resource_name"],
  };
}

export function GlobalObjectReferenceToJSON(json: any): GlobalObjectReference {
  return GlobalObjectReferenceToJSONTyped(json, false);
}

export function GlobalObjectReferenceToJSONTyped(
  value?: Omit<GlobalObjectReference, "related" | "resource_name"> | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    id: value["id"],
  };
}
