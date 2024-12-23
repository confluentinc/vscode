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
import type { ResourceCollectionMetadata } from "./ResourceCollectionMetadata";
import {
  ResourceCollectionMetadataFromJSON,
  ResourceCollectionMetadataFromJSONTyped,
  ResourceCollectionMetadataToJSON,
  ResourceCollectionMetadataToJSONTyped,
} from "./ResourceCollectionMetadata";
import type { TopicData } from "./TopicData";
import {
  TopicDataFromJSON,
  TopicDataFromJSONTyped,
  TopicDataToJSON,
  TopicDataToJSONTyped,
} from "./TopicData";

/**
 *
 * @export
 * @interface TopicDataList
 */
export interface TopicDataList {
  /**
   *
   * @type {string}
   * @memberof TopicDataList
   */
  kind: string;
  /**
   *
   * @type {ResourceCollectionMetadata}
   * @memberof TopicDataList
   */
  metadata: ResourceCollectionMetadata;
  /**
   *
   * @type {Array<TopicData>}
   * @memberof TopicDataList
   */
  data: Array<TopicData>;
}

/**
 * Check if a given object implements the TopicDataList interface.
 */
export function instanceOfTopicDataList(value: object): value is TopicDataList {
  if (!("kind" in value) || value["kind"] === undefined) return false;
  if (!("metadata" in value) || value["metadata"] === undefined) return false;
  if (!("data" in value) || value["data"] === undefined) return false;
  return true;
}

export function TopicDataListFromJSON(json: any): TopicDataList {
  return TopicDataListFromJSONTyped(json, false);
}

export function TopicDataListFromJSONTyped(json: any, ignoreDiscriminator: boolean): TopicDataList {
  if (json == null) {
    return json;
  }
  return {
    kind: json["kind"],
    metadata: ResourceCollectionMetadataFromJSON(json["metadata"]),
    data: (json["data"] as Array<any>).map(TopicDataFromJSON),
  };
}

export function TopicDataListToJSON(json: any): TopicDataList {
  return TopicDataListToJSONTyped(json, false);
}

export function TopicDataListToJSONTyped(
  value?: TopicDataList | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    kind: value["kind"],
    metadata: ResourceCollectionMetadataToJSON(value["metadata"]),
    data: (value["data"] as Array<any>).map(TopicDataToJSON),
  };
}
