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
import type { ConfigSynonymData } from "./ConfigSynonymData";
import {
  ConfigSynonymDataFromJSON,
  ConfigSynonymDataFromJSONTyped,
  ConfigSynonymDataToJSON,
  ConfigSynonymDataToJSONTyped,
} from "./ConfigSynonymData";
import type { ResourceMetadata } from "./ResourceMetadata";
import {
  ResourceMetadataFromJSON,
  ResourceMetadataFromJSONTyped,
  ResourceMetadataToJSON,
  ResourceMetadataToJSONTyped,
} from "./ResourceMetadata";

/**
 *
 * @export
 * @interface AbstractConfigData
 */
export interface AbstractConfigData {
  /**
   *
   * @type {string}
   * @memberof AbstractConfigData
   */
  kind: string;
  /**
   *
   * @type {ResourceMetadata}
   * @memberof AbstractConfigData
   */
  metadata: ResourceMetadata;
  /**
   *
   * @type {string}
   * @memberof AbstractConfigData
   */
  cluster_id: string;
  /**
   *
   * @type {string}
   * @memberof AbstractConfigData
   */
  name: string;
  /**
   *
   * @type {string}
   * @memberof AbstractConfigData
   */
  value?: string | null;
  /**
   *
   * @type {boolean}
   * @memberof AbstractConfigData
   */
  is_default: boolean;
  /**
   *
   * @type {boolean}
   * @memberof AbstractConfigData
   */
  is_read_only: boolean;
  /**
   *
   * @type {boolean}
   * @memberof AbstractConfigData
   */
  is_sensitive: boolean;
  /**
   *
   * @type {string}
   * @memberof AbstractConfigData
   */
  source: string;
  /**
   *
   * @type {Array<ConfigSynonymData>}
   * @memberof AbstractConfigData
   */
  synonyms: Array<ConfigSynonymData>;
}

/**
 * Check if a given object implements the AbstractConfigData interface.
 */
export function instanceOfAbstractConfigData(value: object): value is AbstractConfigData {
  if (!("kind" in value) || value["kind"] === undefined) return false;
  if (!("metadata" in value) || value["metadata"] === undefined) return false;
  if (!("cluster_id" in value) || value["cluster_id"] === undefined) return false;
  if (!("name" in value) || value["name"] === undefined) return false;
  if (!("is_default" in value) || value["is_default"] === undefined) return false;
  if (!("is_read_only" in value) || value["is_read_only"] === undefined) return false;
  if (!("is_sensitive" in value) || value["is_sensitive"] === undefined) return false;
  if (!("source" in value) || value["source"] === undefined) return false;
  if (!("synonyms" in value) || value["synonyms"] === undefined) return false;
  return true;
}

export function AbstractConfigDataFromJSON(json: any): AbstractConfigData {
  return AbstractConfigDataFromJSONTyped(json, false);
}

export function AbstractConfigDataFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): AbstractConfigData {
  if (json == null) {
    return json;
  }
  return {
    kind: json["kind"],
    metadata: ResourceMetadataFromJSON(json["metadata"]),
    cluster_id: json["cluster_id"],
    name: json["name"],
    value: json["value"] == null ? undefined : json["value"],
    is_default: json["is_default"],
    is_read_only: json["is_read_only"],
    is_sensitive: json["is_sensitive"],
    source: json["source"],
    synonyms: (json["synonyms"] as Array<any>).map(ConfigSynonymDataFromJSON),
  };
}

export function AbstractConfigDataToJSON(json: any): AbstractConfigData {
  return AbstractConfigDataToJSONTyped(json, false);
}

export function AbstractConfigDataToJSONTyped(
  value?: AbstractConfigData | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    kind: value["kind"],
    metadata: ResourceMetadataToJSON(value["metadata"]),
    cluster_id: value["cluster_id"],
    name: value["name"],
    value: value["value"],
    is_default: value["is_default"],
    is_read_only: value["is_read_only"],
    is_sensitive: value["is_sensitive"],
    source: value["source"],
    synonyms: (value["synonyms"] as Array<any>).map(ConfigSynonymDataToJSON),
  };
}
