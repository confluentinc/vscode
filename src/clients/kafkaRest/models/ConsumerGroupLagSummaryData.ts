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
 * @interface ConsumerGroupLagSummaryData
 */
export interface ConsumerGroupLagSummaryData {
  /**
   *
   * @type {string}
   * @memberof ConsumerGroupLagSummaryData
   */
  kind: string;
  /**
   *
   * @type {ResourceMetadata}
   * @memberof ConsumerGroupLagSummaryData
   */
  metadata: ResourceMetadata;
  /**
   *
   * @type {string}
   * @memberof ConsumerGroupLagSummaryData
   */
  cluster_id: string;
  /**
   *
   * @type {string}
   * @memberof ConsumerGroupLagSummaryData
   */
  consumer_group_id: string;
  /**
   *
   * @type {string}
   * @memberof ConsumerGroupLagSummaryData
   */
  max_lag_consumer_id: string;
  /**
   *
   * @type {string}
   * @memberof ConsumerGroupLagSummaryData
   */
  max_lag_instance_id?: string | null;
  /**
   *
   * @type {string}
   * @memberof ConsumerGroupLagSummaryData
   */
  max_lag_client_id: string;
  /**
   *
   * @type {string}
   * @memberof ConsumerGroupLagSummaryData
   */
  max_lag_topic_name: string;
  /**
   *
   * @type {number}
   * @memberof ConsumerGroupLagSummaryData
   */
  max_lag_partition_id: number;
  /**
   *
   * @type {number}
   * @memberof ConsumerGroupLagSummaryData
   */
  max_lag: number;
  /**
   *
   * @type {number}
   * @memberof ConsumerGroupLagSummaryData
   */
  total_lag: number;
  /**
   *
   * @type {Relationship}
   * @memberof ConsumerGroupLagSummaryData
   */
  max_lag_consumer: Relationship;
  /**
   *
   * @type {Relationship}
   * @memberof ConsumerGroupLagSummaryData
   */
  max_lag_partition: Relationship;
}

/**
 * Check if a given object implements the ConsumerGroupLagSummaryData interface.
 */
export function instanceOfConsumerGroupLagSummaryData(
  value: object,
): value is ConsumerGroupLagSummaryData {
  if (!("kind" in value) || value["kind"] === undefined) return false;
  if (!("metadata" in value) || value["metadata"] === undefined) return false;
  if (!("cluster_id" in value) || value["cluster_id"] === undefined) return false;
  if (!("consumer_group_id" in value) || value["consumer_group_id"] === undefined) return false;
  if (!("max_lag_consumer_id" in value) || value["max_lag_consumer_id"] === undefined) return false;
  if (!("max_lag_client_id" in value) || value["max_lag_client_id"] === undefined) return false;
  if (!("max_lag_topic_name" in value) || value["max_lag_topic_name"] === undefined) return false;
  if (!("max_lag_partition_id" in value) || value["max_lag_partition_id"] === undefined)
    return false;
  if (!("max_lag" in value) || value["max_lag"] === undefined) return false;
  if (!("total_lag" in value) || value["total_lag"] === undefined) return false;
  if (!("max_lag_consumer" in value) || value["max_lag_consumer"] === undefined) return false;
  if (!("max_lag_partition" in value) || value["max_lag_partition"] === undefined) return false;
  return true;
}

export function ConsumerGroupLagSummaryDataFromJSON(json: any): ConsumerGroupLagSummaryData {
  return ConsumerGroupLagSummaryDataFromJSONTyped(json, false);
}

export function ConsumerGroupLagSummaryDataFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): ConsumerGroupLagSummaryData {
  if (json == null) {
    return json;
  }
  return {
    kind: json["kind"],
    metadata: ResourceMetadataFromJSON(json["metadata"]),
    cluster_id: json["cluster_id"],
    consumer_group_id: json["consumer_group_id"],
    max_lag_consumer_id: json["max_lag_consumer_id"],
    max_lag_instance_id:
      json["max_lag_instance_id"] == null ? undefined : json["max_lag_instance_id"],
    max_lag_client_id: json["max_lag_client_id"],
    max_lag_topic_name: json["max_lag_topic_name"],
    max_lag_partition_id: json["max_lag_partition_id"],
    max_lag: json["max_lag"],
    total_lag: json["total_lag"],
    max_lag_consumer: RelationshipFromJSON(json["max_lag_consumer"]),
    max_lag_partition: RelationshipFromJSON(json["max_lag_partition"]),
  };
}

export function ConsumerGroupLagSummaryDataToJSON(json: any): ConsumerGroupLagSummaryData {
  return ConsumerGroupLagSummaryDataToJSONTyped(json, false);
}

export function ConsumerGroupLagSummaryDataToJSONTyped(
  value?: ConsumerGroupLagSummaryData | null,
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
    max_lag_consumer_id: value["max_lag_consumer_id"],
    max_lag_instance_id: value["max_lag_instance_id"],
    max_lag_client_id: value["max_lag_client_id"],
    max_lag_topic_name: value["max_lag_topic_name"],
    max_lag_partition_id: value["max_lag_partition_id"],
    max_lag: value["max_lag"],
    total_lag: value["total_lag"],
    max_lag_consumer: RelationshipToJSON(value["max_lag_consumer"]),
    max_lag_partition: RelationshipToJSON(value["max_lag_partition"]),
  };
}
