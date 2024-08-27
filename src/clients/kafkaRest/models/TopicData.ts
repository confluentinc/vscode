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
 * @interface TopicData
 */
export interface TopicData {
  /**
   *
   * @type {string}
   * @memberof TopicData
   */
  kind: string;
  /**
   *
   * @type {ResourceMetadata}
   * @memberof TopicData
   */
  metadata: ResourceMetadata;
  /**
   *
   * @type {string}
   * @memberof TopicData
   */
  cluster_id: string;
  /**
   *
   * @type {string}
   * @memberof TopicData
   */
  topic_name: string;
  /**
   *
   * @type {boolean}
   * @memberof TopicData
   */
  is_internal: boolean;
  /**
   *
   * @type {number}
   * @memberof TopicData
   */
  replication_factor: number;
  /**
   *
   * @type {number}
   * @memberof TopicData
   */
  partitions_count: number;
  /**
   *
   * @type {Relationship}
   * @memberof TopicData
   */
  partitions: Relationship;
  /**
   *
   * @type {Relationship}
   * @memberof TopicData
   */
  configs: Relationship;
  /**
   *
   * @type {Relationship}
   * @memberof TopicData
   */
  partition_reassignments: Relationship;
  /**
   *
   * @type {Array<string>}
   * @memberof TopicData
   */
  authorized_operations?: Array<string>;
}

/**
 * Check if a given object implements the TopicData interface.
 */
export function instanceOfTopicData(value: object): value is TopicData {
  if (!("kind" in value) || value["kind"] === undefined) return false;
  if (!("metadata" in value) || value["metadata"] === undefined) return false;
  if (!("cluster_id" in value) || value["cluster_id"] === undefined) return false;
  if (!("topic_name" in value) || value["topic_name"] === undefined) return false;
  if (!("is_internal" in value) || value["is_internal"] === undefined) return false;
  if (!("replication_factor" in value) || value["replication_factor"] === undefined) return false;
  if (!("partitions_count" in value) || value["partitions_count"] === undefined) return false;
  if (!("partitions" in value) || value["partitions"] === undefined) return false;
  if (!("configs" in value) || value["configs"] === undefined) return false;
  if (!("partition_reassignments" in value) || value["partition_reassignments"] === undefined)
    return false;
  return true;
}

export function TopicDataFromJSON(json: any): TopicData {
  return TopicDataFromJSONTyped(json, false);
}

export function TopicDataFromJSONTyped(json: any, ignoreDiscriminator: boolean): TopicData {
  if (json == null) {
    return json;
  }
  return {
    kind: json["kind"],
    metadata: ResourceMetadataFromJSON(json["metadata"]),
    cluster_id: json["cluster_id"],
    topic_name: json["topic_name"],
    is_internal: json["is_internal"],
    replication_factor: json["replication_factor"],
    partitions_count: json["partitions_count"],
    partitions: RelationshipFromJSON(json["partitions"]),
    configs: RelationshipFromJSON(json["configs"]),
    partition_reassignments: RelationshipFromJSON(json["partition_reassignments"]),
    authorized_operations:
      json["authorized_operations"] == null ? undefined : json["authorized_operations"],
  };
}

export function TopicDataToJSON(value?: TopicData | null): any {
  if (value == null) {
    return value;
  }
  return {
    kind: value["kind"],
    metadata: ResourceMetadataToJSON(value["metadata"]),
    cluster_id: value["cluster_id"],
    topic_name: value["topic_name"],
    is_internal: value["is_internal"],
    replication_factor: value["replication_factor"],
    partitions_count: value["partitions_count"],
    partitions: RelationshipToJSON(value["partitions"]),
    configs: RelationshipToJSON(value["configs"]),
    partition_reassignments: RelationshipToJSON(value["partition_reassignments"]),
    authorized_operations: value["authorized_operations"],
  };
}
