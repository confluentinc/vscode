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
import type { Relationship } from "./Relationship";
import {
  RelationshipFromJSON,
  RelationshipFromJSONTyped,
  RelationshipToJSON,
  RelationshipToJSONTyped,
} from "./Relationship";
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
 * @interface ConsumerGroupData
 */
export interface ConsumerGroupData {
  /**
   *
   * @type {string}
   * @memberof ConsumerGroupData
   */
  kind: string;
  /**
   *
   * @type {ResourceMetadata}
   * @memberof ConsumerGroupData
   */
  metadata: ResourceMetadata;
  /**
   *
   * @type {string}
   * @memberof ConsumerGroupData
   */
  cluster_id: string;
  /**
   *
   * @type {string}
   * @memberof ConsumerGroupData
   */
  consumer_group_id: string;
  /**
   *
   * @type {boolean}
   * @memberof ConsumerGroupData
   */
  is_simple: boolean;
  /**
   *
   * @type {string}
   * @memberof ConsumerGroupData
   */
  partition_assignor: string;
  /**
   *
   * @type {string}
   * @memberof ConsumerGroupData
   */
  state: string;
  /**
   *
   * @type {Relationship}
   * @memberof ConsumerGroupData
   */
  coordinator: Relationship;
  /**
   *
   * @type {Relationship}
   * @memberof ConsumerGroupData
   */
  consumer?: Relationship;
  /**
   *
   * @type {Relationship}
   * @memberof ConsumerGroupData
   */
  lag_summary: Relationship;
}

/**
 * Check if a given object implements the ConsumerGroupData interface.
 */
export function instanceOfConsumerGroupData(value: object): value is ConsumerGroupData {
  if (!("kind" in value) || value["kind"] === undefined) return false;
  if (!("metadata" in value) || value["metadata"] === undefined) return false;
  if (!("cluster_id" in value) || value["cluster_id"] === undefined) return false;
  if (!("consumer_group_id" in value) || value["consumer_group_id"] === undefined) return false;
  if (!("is_simple" in value) || value["is_simple"] === undefined) return false;
  if (!("partition_assignor" in value) || value["partition_assignor"] === undefined) return false;
  if (!("state" in value) || value["state"] === undefined) return false;
  if (!("coordinator" in value) || value["coordinator"] === undefined) return false;
  if (!("lag_summary" in value) || value["lag_summary"] === undefined) return false;
  return true;
}

export function ConsumerGroupDataFromJSON(json: any): ConsumerGroupData {
  return ConsumerGroupDataFromJSONTyped(json, false);
}

export function ConsumerGroupDataFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): ConsumerGroupData {
  if (json == null) {
    return json;
  }
  return {
    kind: json["kind"],
    metadata: ResourceMetadataFromJSON(json["metadata"]),
    cluster_id: json["cluster_id"],
    consumer_group_id: json["consumer_group_id"],
    is_simple: json["is_simple"],
    partition_assignor: json["partition_assignor"],
    state: json["state"],
    coordinator: RelationshipFromJSON(json["coordinator"]),
    consumer: json["consumer"] == null ? undefined : RelationshipFromJSON(json["consumer"]),
    lag_summary: RelationshipFromJSON(json["lag_summary"]),
  };
}

export function ConsumerGroupDataToJSON(json: any): ConsumerGroupData {
  return ConsumerGroupDataToJSONTyped(json, false);
}

export function ConsumerGroupDataToJSONTyped(
  value?: ConsumerGroupData | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    kind: value["kind"],
    metadata: ResourceMetadataToJSON(value["metadata"]),
    cluster_id: value["cluster_id"],
    consumer_group_id: value["consumer_group_id"],
    is_simple: value["is_simple"],
    partition_assignor: value["partition_assignor"],
    state: value["state"],
    coordinator: RelationshipToJSON(value["coordinator"]),
    consumer: RelationshipToJSON(value["consumer"]),
    lag_summary: RelationshipToJSON(value["lag_summary"]),
  };
}
