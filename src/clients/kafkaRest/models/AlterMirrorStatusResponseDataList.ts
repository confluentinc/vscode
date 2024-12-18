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
import type { AlterMirrorStatusResponseData } from "./AlterMirrorStatusResponseData";
import {
  AlterMirrorStatusResponseDataFromJSON,
  AlterMirrorStatusResponseDataFromJSONTyped,
  AlterMirrorStatusResponseDataToJSON,
  AlterMirrorStatusResponseDataToJSONTyped,
} from "./AlterMirrorStatusResponseData";

/**
 *
 * @export
 * @interface AlterMirrorStatusResponseDataList
 */
export interface AlterMirrorStatusResponseDataList {
  /**
   *
   * @type {string}
   * @memberof AlterMirrorStatusResponseDataList
   */
  kind: string;
  /**
   *
   * @type {ResourceCollectionMetadata}
   * @memberof AlterMirrorStatusResponseDataList
   */
  metadata: ResourceCollectionMetadata;
  /**
   *
   * @type {Array<AlterMirrorStatusResponseData>}
   * @memberof AlterMirrorStatusResponseDataList
   */
  data: Array<AlterMirrorStatusResponseData>;
}

/**
 * Check if a given object implements the AlterMirrorStatusResponseDataList interface.
 */
export function instanceOfAlterMirrorStatusResponseDataList(
  value: object,
): value is AlterMirrorStatusResponseDataList {
  if (!("kind" in value) || value["kind"] === undefined) return false;
  if (!("metadata" in value) || value["metadata"] === undefined) return false;
  if (!("data" in value) || value["data"] === undefined) return false;
  return true;
}

export function AlterMirrorStatusResponseDataListFromJSON(
  json: any,
): AlterMirrorStatusResponseDataList {
  return AlterMirrorStatusResponseDataListFromJSONTyped(json, false);
}

export function AlterMirrorStatusResponseDataListFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): AlterMirrorStatusResponseDataList {
  if (json == null) {
    return json;
  }
  return {
    kind: json["kind"],
    metadata: ResourceCollectionMetadataFromJSON(json["metadata"]),
    data: (json["data"] as Array<any>).map(AlterMirrorStatusResponseDataFromJSON),
  };
}

export function AlterMirrorStatusResponseDataListToJSON(
  json: any,
): AlterMirrorStatusResponseDataList {
  return AlterMirrorStatusResponseDataListToJSONTyped(json, false);
}

export function AlterMirrorStatusResponseDataListToJSONTyped(
  value?: AlterMirrorStatusResponseDataList | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    kind: value["kind"],
    metadata: ResourceCollectionMetadataToJSON(value["metadata"]),
    data: (value["data"] as Array<any>).map(AlterMirrorStatusResponseDataToJSON),
  };
}
