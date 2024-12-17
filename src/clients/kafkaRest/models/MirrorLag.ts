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
 * @interface MirrorLag
 */
export interface MirrorLag {
  /**
   *
   * @type {number}
   * @memberof MirrorLag
   */
  partition: number;
  /**
   *
   * @type {number}
   * @memberof MirrorLag
   */
  lag: number;
  /**
   *
   * @type {number}
   * @memberof MirrorLag
   */
  last_source_fetch_offset: number;
}

/**
 * Check if a given object implements the MirrorLag interface.
 */
export function instanceOfMirrorLag(value: object): value is MirrorLag {
  if (!("partition" in value) || value["partition"] === undefined) return false;
  if (!("lag" in value) || value["lag"] === undefined) return false;
  if (!("last_source_fetch_offset" in value) || value["last_source_fetch_offset"] === undefined)
    return false;
  return true;
}

export function MirrorLagFromJSON(json: any): MirrorLag {
  return MirrorLagFromJSONTyped(json, false);
}

export function MirrorLagFromJSONTyped(json: any, ignoreDiscriminator: boolean): MirrorLag {
  if (json == null) {
    return json;
  }
  return {
    partition: json["partition"],
    lag: json["lag"],
    last_source_fetch_offset: json["last_source_fetch_offset"],
  };
}

export function MirrorLagToJSON(json: any): MirrorLag {
  return MirrorLagToJSONTyped(json, false);
}

export function MirrorLagToJSONTyped(
  value?: MirrorLag | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    partition: value["partition"],
    lag: value["lag"],
    last_source_fetch_offset: value["last_source_fetch_offset"],
  };
}
