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
import type { ConsumerAssignmentData } from "./ConsumerAssignmentData";
import {
  ConsumerAssignmentDataFromJSON,
  ConsumerAssignmentDataFromJSONTyped,
  ConsumerAssignmentDataToJSON,
} from "./ConsumerAssignmentData";

/**
 *
 * @export
 * @interface ConsumerAssignmentDataList
 */
export interface ConsumerAssignmentDataList {
  /**
   *
   * @type {string}
   * @memberof ConsumerAssignmentDataList
   */
  kind: string;
  /**
   *
   * @type {ResourceCollectionMetadata}
   * @memberof ConsumerAssignmentDataList
   */
  metadata: ResourceCollectionMetadata;
  /**
   *
   * @type {Array<ConsumerAssignmentData>}
   * @memberof ConsumerAssignmentDataList
   */
  data: Array<ConsumerAssignmentData>;
}

/**
 * Check if a given object implements the ConsumerAssignmentDataList interface.
 */
export function instanceOfConsumerAssignmentDataList(
  value: object,
): value is ConsumerAssignmentDataList {
  if (!("kind" in value) || value["kind"] === undefined) return false;
  if (!("metadata" in value) || value["metadata"] === undefined) return false;
  if (!("data" in value) || value["data"] === undefined) return false;
  return true;
}

export function ConsumerAssignmentDataListFromJSON(json: any): ConsumerAssignmentDataList {
  return ConsumerAssignmentDataListFromJSONTyped(json, false);
}

export function ConsumerAssignmentDataListFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): ConsumerAssignmentDataList {
  if (json == null) {
    return json;
  }
  return {
    kind: json["kind"],
    metadata: ResourceCollectionMetadataFromJSON(json["metadata"]),
    data: (json["data"] as Array<any>).map(ConsumerAssignmentDataFromJSON),
  };
}

export function ConsumerAssignmentDataListToJSON(value?: ConsumerAssignmentDataList | null): any {
  if (value == null) {
    return value;
  }
  return {
    kind: value["kind"],
    metadata: ResourceCollectionMetadataToJSON(value["metadata"]),
    data: (value["data"] as Array<any>).map(ConsumerAssignmentDataToJSON),
  };
}
