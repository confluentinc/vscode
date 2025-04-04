/* tslint:disable */
/* eslint-disable */
/**
 * Flink Compute Pool Management API
 * This is the Flink Compute Pool management API.
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
 * @interface EnvScopedObjectReference
 */
export interface EnvScopedObjectReference {
  /**
   * ID of the referred resource
   * @type {string}
   * @memberof EnvScopedObjectReference
   */
  id: string;
  /**
   * Environment of the referred resource, if env-scoped
   * @type {string}
   * @memberof EnvScopedObjectReference
   */
  environment?: string;
  /**
   * API URL for accessing or modifying the referred object
   * @type {string}
   * @memberof EnvScopedObjectReference
   */
  readonly related: string;
  /**
   * CRN reference to the referred resource
   * @type {string}
   * @memberof EnvScopedObjectReference
   */
  readonly resource_name: string;
}

/**
 * Check if a given object implements the EnvScopedObjectReference interface.
 */
export function instanceOfEnvScopedObjectReference(
  value: object,
): value is EnvScopedObjectReference {
  if (!("id" in value) || value["id"] === undefined) return false;
  if (!("related" in value) || value["related"] === undefined) return false;
  if (!("resource_name" in value) || value["resource_name"] === undefined) return false;
  return true;
}

export function EnvScopedObjectReferenceFromJSON(json: any): EnvScopedObjectReference {
  return EnvScopedObjectReferenceFromJSONTyped(json, false);
}

export function EnvScopedObjectReferenceFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): EnvScopedObjectReference {
  if (json == null) {
    return json;
  }
  return {
    id: json["id"],
    environment: json["environment"] == null ? undefined : json["environment"],
    related: json["related"],
    resource_name: json["resource_name"],
  };
}

export function EnvScopedObjectReferenceToJSON(json: any): EnvScopedObjectReference {
  return EnvScopedObjectReferenceToJSONTyped(json, false);
}

export function EnvScopedObjectReferenceToJSONTyped(
  value?: Omit<EnvScopedObjectReference, "related" | "resource_name"> | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    id: value["id"],
    environment: value["environment"],
  };
}
