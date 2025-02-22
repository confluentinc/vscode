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
import type { ConsumerData } from "./ConsumerData";
import {
  ConsumerDataFromJSON,
  ConsumerDataFromJSONTyped,
  ConsumerDataToJSON,
  ConsumerDataToJSONTyped,
} from "./ConsumerData";

/**
 *
 * @export
 * @interface ConsumerDataList
 */
export interface ConsumerDataList {
  /**
   *
   * @type {string}
   * @memberof ConsumerDataList
   */
  kind: string;
  /**
   *
   * @type {ResourceCollectionMetadata}
   * @memberof ConsumerDataList
   */
  metadata: ResourceCollectionMetadata;
  /**
   *
   * @type {Array<ConsumerData>}
   * @memberof ConsumerDataList
   */
  data: Array<ConsumerData>;
}

/**
 * Check if a given object implements the ConsumerDataList interface.
 */
export function instanceOfConsumerDataList(value: object): value is ConsumerDataList {
  if (!("kind" in value) || value["kind"] === undefined) return false;
  if (!("metadata" in value) || value["metadata"] === undefined) return false;
  if (!("data" in value) || value["data"] === undefined) return false;
  return true;
}

export function ConsumerDataListFromJSON(json: any): ConsumerDataList {
  return ConsumerDataListFromJSONTyped(json, false);
}

export function ConsumerDataListFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): ConsumerDataList {
  if (json == null) {
    return json;
  }
  return {
    kind: json["kind"],
    metadata: ResourceCollectionMetadataFromJSON(json["metadata"]),
    data: (json["data"] as Array<any>).map(ConsumerDataFromJSON),
  };
}

export function ConsumerDataListToJSON(json: any): ConsumerDataList {
  return ConsumerDataListToJSONTyped(json, false);
}

export function ConsumerDataListToJSONTyped(
  value?: ConsumerDataList | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    kind: value["kind"],
    metadata: ResourceCollectionMetadataToJSON(value["metadata"]),
    data: (value["data"] as Array<any>).map(ConsumerDataToJSON),
  };
}
