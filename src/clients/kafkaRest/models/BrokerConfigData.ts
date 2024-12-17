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
 * @interface BrokerConfigData
 */
export interface BrokerConfigData {
  /**
   *
   * @type {string}
   * @memberof BrokerConfigData
   */
  kind: string;
  /**
   *
   * @type {ResourceMetadata}
   * @memberof BrokerConfigData
   */
  metadata: ResourceMetadata;
  /**
   *
   * @type {string}
   * @memberof BrokerConfigData
   */
  cluster_id: string;
  /**
   *
   * @type {string}
   * @memberof BrokerConfigData
   */
  name: string;
  /**
   *
   * @type {string}
   * @memberof BrokerConfigData
   */
  value?: string | null;
  /**
   *
   * @type {boolean}
   * @memberof BrokerConfigData
   */
  is_default: boolean;
  /**
   *
   * @type {boolean}
   * @memberof BrokerConfigData
   */
  is_read_only: boolean;
  /**
   *
   * @type {boolean}
   * @memberof BrokerConfigData
   */
  is_sensitive: boolean;
  /**
   *
   * @type {string}
   * @memberof BrokerConfigData
   */
  source: string;
  /**
   *
   * @type {Array<ConfigSynonymData>}
   * @memberof BrokerConfigData
   */
  synonyms: Array<ConfigSynonymData>;
  /**
   *
   * @type {number}
   * @memberof BrokerConfigData
   */
  broker_id: number;
}

/**
 * Check if a given object implements the BrokerConfigData interface.
 */
export function instanceOfBrokerConfigData(value: object): value is BrokerConfigData {
  if (!("kind" in value) || value["kind"] === undefined) return false;
  if (!("metadata" in value) || value["metadata"] === undefined) return false;
  if (!("cluster_id" in value) || value["cluster_id"] === undefined) return false;
  if (!("name" in value) || value["name"] === undefined) return false;
  if (!("is_default" in value) || value["is_default"] === undefined) return false;
  if (!("is_read_only" in value) || value["is_read_only"] === undefined) return false;
  if (!("is_sensitive" in value) || value["is_sensitive"] === undefined) return false;
  if (!("source" in value) || value["source"] === undefined) return false;
  if (!("synonyms" in value) || value["synonyms"] === undefined) return false;
  if (!("broker_id" in value) || value["broker_id"] === undefined) return false;
  return true;
}

export function BrokerConfigDataFromJSON(json: any): BrokerConfigData {
  return BrokerConfigDataFromJSONTyped(json, false);
}

export function BrokerConfigDataFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): BrokerConfigData {
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
    broker_id: json["broker_id"],
  };
}

export function BrokerConfigDataToJSON(json: any): BrokerConfigData {
  return BrokerConfigDataToJSONTyped(json, false);
}

export function BrokerConfigDataToJSONTyped(
  value?: BrokerConfigData | null,
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
    broker_id: value["broker_id"],
  };
}
