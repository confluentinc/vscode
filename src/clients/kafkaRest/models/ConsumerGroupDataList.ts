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
import type { ConsumerGroupData } from "./ConsumerGroupData";
import {
  ConsumerGroupDataFromJSON,
  ConsumerGroupDataFromJSONTyped,
  ConsumerGroupDataToJSON,
  ConsumerGroupDataToJSONTyped,
} from "./ConsumerGroupData";

/**
 *
 * @export
 * @interface ConsumerGroupDataList
 */
export interface ConsumerGroupDataList {
  /**
   *
   * @type {string}
   * @memberof ConsumerGroupDataList
   */
  kind: string;
  /**
   *
   * @type {ResourceCollectionMetadata}
   * @memberof ConsumerGroupDataList
   */
  metadata: ResourceCollectionMetadata;
  /**
   *
   * @type {Array<ConsumerGroupData>}
   * @memberof ConsumerGroupDataList
   */
  data: Array<ConsumerGroupData>;
}

/**
 * Check if a given object implements the ConsumerGroupDataList interface.
 */
export function instanceOfConsumerGroupDataList(value: object): value is ConsumerGroupDataList {
  if (!("kind" in value) || value["kind"] === undefined) return false;
  if (!("metadata" in value) || value["metadata"] === undefined) return false;
  if (!("data" in value) || value["data"] === undefined) return false;
  return true;
}

export function ConsumerGroupDataListFromJSON(json: any): ConsumerGroupDataList {
  return ConsumerGroupDataListFromJSONTyped(json, false);
}

export function ConsumerGroupDataListFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): ConsumerGroupDataList {
  if (json == null) {
    return json;
  }
  return {
    kind: json["kind"],
    metadata: ResourceCollectionMetadataFromJSON(json["metadata"]),
    data: (json["data"] as Array<any>).map(ConsumerGroupDataFromJSON),
  };
}

export function ConsumerGroupDataListToJSON(json: any): ConsumerGroupDataList {
  return ConsumerGroupDataListToJSONTyped(json, false);
}

export function ConsumerGroupDataListToJSONTyped(
  value?: ConsumerGroupDataList | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    kind: value["kind"],
    metadata: ResourceCollectionMetadataToJSON(value["metadata"]),
    data: (value["data"] as Array<any>).map(ConsumerGroupDataToJSON),
  };
}
