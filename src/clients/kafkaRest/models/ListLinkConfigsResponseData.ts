/* tslint:disable */
/* eslint-disable */
/**
 * REST Admin API
 * No description provided (generated by Openapi Generator https://github.com/openapitools/openapi-generator)
 *
 * The version of the OpenAPI document: 3.0.0
 * Contact: kafka-clients-proxy-team@confluent.io
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */

import { mapValues } from "../runtime";
import type { ResourceMetadata } from "./ResourceMetadata";
import {
  ResourceMetadataFromJSON,
  ResourceMetadataFromJSONTyped,
  ResourceMetadataToJSON,
} from "./ResourceMetadata";

/**
 *
 * @export
 * @interface ListLinkConfigsResponseData
 */
export interface ListLinkConfigsResponseData {
  /**
   *
   * @type {string}
   * @memberof ListLinkConfigsResponseData
   */
  kind: string;
  /**
   *
   * @type {ResourceMetadata}
   * @memberof ListLinkConfigsResponseData
   */
  metadata: ResourceMetadata;
  /**
   *
   * @type {string}
   * @memberof ListLinkConfigsResponseData
   */
  cluster_id: string;
  /**
   *
   * @type {string}
   * @memberof ListLinkConfigsResponseData
   */
  name: string;
  /**
   *
   * @type {string}
   * @memberof ListLinkConfigsResponseData
   */
  value: string;
  /**
   *
   * @type {boolean}
   * @memberof ListLinkConfigsResponseData
   */
  read_only: boolean;
  /**
   *
   * @type {boolean}
   * @memberof ListLinkConfigsResponseData
   */
  sensitive: boolean;
  /**
   *
   * @type {string}
   * @memberof ListLinkConfigsResponseData
   */
  source: string;
  /**
   *
   * @type {Array<string>}
   * @memberof ListLinkConfigsResponseData
   */
  synonyms: Array<string>;
  /**
   *
   * @type {string}
   * @memberof ListLinkConfigsResponseData
   */
  link_name: string;
}

/**
 * Check if a given object implements the ListLinkConfigsResponseData interface.
 */
export function instanceOfListLinkConfigsResponseData(
  value: object,
): value is ListLinkConfigsResponseData {
  if (!("kind" in value) || value["kind"] === undefined) return false;
  if (!("metadata" in value) || value["metadata"] === undefined) return false;
  if (!("cluster_id" in value) || value["cluster_id"] === undefined) return false;
  if (!("name" in value) || value["name"] === undefined) return false;
  if (!("value" in value) || value["value"] === undefined) return false;
  if (!("read_only" in value) || value["read_only"] === undefined) return false;
  if (!("sensitive" in value) || value["sensitive"] === undefined) return false;
  if (!("source" in value) || value["source"] === undefined) return false;
  if (!("synonyms" in value) || value["synonyms"] === undefined) return false;
  if (!("link_name" in value) || value["link_name"] === undefined) return false;
  return true;
}

export function ListLinkConfigsResponseDataFromJSON(json: any): ListLinkConfigsResponseData {
  return ListLinkConfigsResponseDataFromJSONTyped(json, false);
}

export function ListLinkConfigsResponseDataFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): ListLinkConfigsResponseData {
  if (json == null) {
    return json;
  }
  return {
    kind: json["kind"],
    metadata: ResourceMetadataFromJSON(json["metadata"]),
    cluster_id: json["cluster_id"],
    name: json["name"],
    value: json["value"],
    read_only: json["read_only"],
    sensitive: json["sensitive"],
    source: json["source"],
    synonyms: json["synonyms"],
    link_name: json["link_name"],
  };
}

export function ListLinkConfigsResponseDataToJSON(value?: ListLinkConfigsResponseData | null): any {
  if (value == null) {
    return value;
  }
  return {
    kind: value["kind"],
    metadata: ResourceMetadataToJSON(value["metadata"]),
    cluster_id: value["cluster_id"],
    name: value["name"],
    value: value["value"],
    read_only: value["read_only"],
    sensitive: value["sensitive"],
    source: value["source"],
    synonyms: value["synonyms"],
    link_name: value["link_name"],
  };
}
