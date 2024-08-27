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
import type { Relationship } from "./Relationship";
import {
  RelationshipFromJSON,
  RelationshipFromJSONTyped,
  RelationshipToJSON,
} from "./Relationship";
import type { ResourceMetadata } from "./ResourceMetadata";
import {
  ResourceMetadataFromJSON,
  ResourceMetadataFromJSONTyped,
  ResourceMetadataToJSON,
} from "./ResourceMetadata";

/**
 *
 * @export
 * @interface ConsumerAssignmentData
 */
export interface ConsumerAssignmentData {
  /**
   *
   * @type {string}
   * @memberof ConsumerAssignmentData
   */
  kind: string;
  /**
   *
   * @type {ResourceMetadata}
   * @memberof ConsumerAssignmentData
   */
  metadata: ResourceMetadata;
  /**
   *
   * @type {string}
   * @memberof ConsumerAssignmentData
   */
  cluster_id: string;
  /**
   *
   * @type {string}
   * @memberof ConsumerAssignmentData
   */
  consumer_group_id: string;
  /**
   *
   * @type {string}
   * @memberof ConsumerAssignmentData
   */
  consumer_id: string;
  /**
   *
   * @type {string}
   * @memberof ConsumerAssignmentData
   */
  topic_name: string;
  /**
   *
   * @type {number}
   * @memberof ConsumerAssignmentData
   */
  partition_id: number;
  /**
   *
   * @type {Relationship}
   * @memberof ConsumerAssignmentData
   */
  partition: Relationship;
  /**
   *
   * @type {Relationship}
   * @memberof ConsumerAssignmentData
   */
  lag: Relationship;
}

/**
 * Check if a given object implements the ConsumerAssignmentData interface.
 */
export function instanceOfConsumerAssignmentData(value: object): value is ConsumerAssignmentData {
  if (!("kind" in value) || value["kind"] === undefined) return false;
  if (!("metadata" in value) || value["metadata"] === undefined) return false;
  if (!("cluster_id" in value) || value["cluster_id"] === undefined) return false;
  if (!("consumer_group_id" in value) || value["consumer_group_id"] === undefined) return false;
  if (!("consumer_id" in value) || value["consumer_id"] === undefined) return false;
  if (!("topic_name" in value) || value["topic_name"] === undefined) return false;
  if (!("partition_id" in value) || value["partition_id"] === undefined) return false;
  if (!("partition" in value) || value["partition"] === undefined) return false;
  if (!("lag" in value) || value["lag"] === undefined) return false;
  return true;
}

export function ConsumerAssignmentDataFromJSON(json: any): ConsumerAssignmentData {
  return ConsumerAssignmentDataFromJSONTyped(json, false);
}

export function ConsumerAssignmentDataFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): ConsumerAssignmentData {
  if (json == null) {
    return json;
  }
  return {
    kind: json["kind"],
    metadata: ResourceMetadataFromJSON(json["metadata"]),
    cluster_id: json["cluster_id"],
    consumer_group_id: json["consumer_group_id"],
    consumer_id: json["consumer_id"],
    topic_name: json["topic_name"],
    partition_id: json["partition_id"],
    partition: RelationshipFromJSON(json["partition"]),
    lag: RelationshipFromJSON(json["lag"]),
  };
}

export function ConsumerAssignmentDataToJSON(value?: ConsumerAssignmentData | null): any {
  if (value == null) {
    return value;
  }
  return {
    kind: value["kind"],
    metadata: ResourceMetadataToJSON(value["metadata"]),
    cluster_id: value["cluster_id"],
    consumer_group_id: value["consumer_group_id"],
    consumer_id: value["consumer_id"],
    topic_name: value["topic_name"],
    partition_id: value["partition_id"],
    partition: RelationshipToJSON(value["partition"]),
    lag: RelationshipToJSON(value["lag"]),
  };
}
