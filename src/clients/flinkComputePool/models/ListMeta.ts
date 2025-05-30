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
 * ListMeta describes metadata that resource collections may have
 * @export
 * @interface ListMeta
 */
export interface ListMeta {
  /**
   * A link to the first page of results. If a response does not contain a first link, then direct navigation to the first page is not supported.
   * @type {string}
   * @memberof ListMeta
   */
  first?: string | null;
  /**
   * A link to the last page of results. If a response does not contain a last link, then direct navigation to the last page is not supported.
   * @type {string}
   * @memberof ListMeta
   */
  last?: string | null;
  /**
   * A link to the previous page of results. If a response does not contain a prev link, then either there is no previous data or backwards traversal through the result set is not supported.
   * @type {string}
   * @memberof ListMeta
   */
  prev?: string | null;
  /**
   * A link to the next page of results. If a response does not contain a next link, then there is no more data available.
   * @type {string}
   * @memberof ListMeta
   */
  next?: string | null;
  /**
   * Number of records in the full result set. This response may be paginated and have a smaller number of records.
   * @type {number}
   * @memberof ListMeta
   */
  total_size?: number;
}

/**
 * Check if a given object implements the ListMeta interface.
 */
export function instanceOfListMeta(value: object): value is ListMeta {
  return true;
}

export function ListMetaFromJSON(json: any): ListMeta {
  return ListMetaFromJSONTyped(json, false);
}

export function ListMetaFromJSONTyped(json: any, ignoreDiscriminator: boolean): ListMeta {
  if (json == null) {
    return json;
  }
  return {
    first: json["first"] == null ? undefined : json["first"],
    last: json["last"] == null ? undefined : json["last"],
    prev: json["prev"] == null ? undefined : json["prev"],
    next: json["next"] == null ? undefined : json["next"],
    total_size: json["total_size"] == null ? undefined : json["total_size"],
  };
}

export function ListMetaToJSON(json: any): ListMeta {
  return ListMetaToJSONTyped(json, false);
}

export function ListMetaToJSONTyped(
  value?: ListMeta | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    first: value["first"],
    last: value["last"],
    prev: value["prev"],
    next: value["next"],
    total_size: value["total_size"],
  };
}
