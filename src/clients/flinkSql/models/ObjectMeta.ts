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
 * The metadata of the statement.
 * @export
 * @interface ObjectMeta
 */
export interface ObjectMeta {
  /**
   * Self is a Uniform Resource Locator (URL) at which an object can be addressed. This URL encodes the service location, API version, and other particulars necessary to locate the resource at a point in time
   * @type {string}
   * @memberof ObjectMeta
   */
  self: string;
  /**
   * The date and time at which this object was created. It is represented in RFC3339 format and is in UTC.
   * @type {Date}
   * @memberof ObjectMeta
   */
  created_at?: Date;
  /**
   * The date and time at which this object was last updated. It is represented in RFC3339 format and is in UTC.
   * @type {Date}
   * @memberof ObjectMeta
   */
  updated_at?: Date;
  /**
   * A system generated globally unique identifier for this resource.
   * @type {string}
   * @memberof ObjectMeta
   */
  uid?: string;
  /**
   * A system generated string that uniquely identifies the version of this resource.
   * @type {string}
   * @memberof ObjectMeta
   */
  resource_version?: string;
}

/**
 * Check if a given object implements the ObjectMeta interface.
 */
export function instanceOfObjectMeta(value: object): value is ObjectMeta {
  if (!("self" in value) || value["self"] === undefined) return false;
  return true;
}

export function ObjectMetaFromJSON(json: any): ObjectMeta {
  return ObjectMetaFromJSONTyped(json, false);
}

export function ObjectMetaFromJSONTyped(json: any, ignoreDiscriminator: boolean): ObjectMeta {
  if (json == null) {
    return json;
  }
  return {
    self: json["self"],
    created_at: json["created_at"] == null ? undefined : new Date(json["created_at"]),
    updated_at: json["updated_at"] == null ? undefined : new Date(json["updated_at"]),
    uid: json["uid"] == null ? undefined : json["uid"],
    resource_version: json["resource_version"] == null ? undefined : json["resource_version"],
  };
}

export function ObjectMetaToJSON(json: any): ObjectMeta {
  return ObjectMetaToJSONTyped(json, false);
}

export function ObjectMetaToJSONTyped(
  value?: ObjectMeta | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    self: value["self"],
    created_at: value["created_at"] == null ? undefined : value["created_at"].toISOString(),
    updated_at: value["updated_at"] == null ? undefined : value["updated_at"].toISOString(),
    uid: value["uid"],
    resource_version: value["resource_version"],
  };
}
