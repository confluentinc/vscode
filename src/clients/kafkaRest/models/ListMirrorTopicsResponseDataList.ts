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
import type { ResourceCollectionMetadata } from "./ResourceCollectionMetadata";
import {
  ResourceCollectionMetadataFromJSON,
  ResourceCollectionMetadataFromJSONTyped,
  ResourceCollectionMetadataToJSON,
} from "./ResourceCollectionMetadata";
import type { ListMirrorTopicsResponseData } from "./ListMirrorTopicsResponseData";
import {
  ListMirrorTopicsResponseDataFromJSON,
  ListMirrorTopicsResponseDataFromJSONTyped,
  ListMirrorTopicsResponseDataToJSON,
} from "./ListMirrorTopicsResponseData";

/**
 *
 * @export
 * @interface ListMirrorTopicsResponseDataList
 */
export interface ListMirrorTopicsResponseDataList {
  /**
   *
   * @type {string}
   * @memberof ListMirrorTopicsResponseDataList
   */
  kind: string;
  /**
   *
   * @type {ResourceCollectionMetadata}
   * @memberof ListMirrorTopicsResponseDataList
   */
  metadata: ResourceCollectionMetadata;
  /**
   *
   * @type {Array<ListMirrorTopicsResponseData>}
   * @memberof ListMirrorTopicsResponseDataList
   */
  data: Array<ListMirrorTopicsResponseData>;
}

/**
 * Check if a given object implements the ListMirrorTopicsResponseDataList interface.
 */
export function instanceOfListMirrorTopicsResponseDataList(
  value: object,
): value is ListMirrorTopicsResponseDataList {
  if (!("kind" in value) || value["kind"] === undefined) return false;
  if (!("metadata" in value) || value["metadata"] === undefined) return false;
  if (!("data" in value) || value["data"] === undefined) return false;
  return true;
}

export function ListMirrorTopicsResponseDataListFromJSON(
  json: any,
): ListMirrorTopicsResponseDataList {
  return ListMirrorTopicsResponseDataListFromJSONTyped(json, false);
}

export function ListMirrorTopicsResponseDataListFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): ListMirrorTopicsResponseDataList {
  if (json == null) {
    return json;
  }
  return {
    kind: json["kind"],
    metadata: ResourceCollectionMetadataFromJSON(json["metadata"]),
    data: (json["data"] as Array<any>).map(ListMirrorTopicsResponseDataFromJSON),
  };
}

export function ListMirrorTopicsResponseDataListToJSON(
  value?: ListMirrorTopicsResponseDataList | null,
): any {
  if (value == null) {
    return value;
  }
  return {
    kind: value["kind"],
    metadata: ResourceCollectionMetadataToJSON(value["metadata"]),
    data: (value["data"] as Array<any>).map(ListMirrorTopicsResponseDataToJSON),
  };
}
