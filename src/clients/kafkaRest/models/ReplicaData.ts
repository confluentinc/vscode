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
 * @interface ReplicaData
 */
export interface ReplicaData {
  /**
   *
   * @type {string}
   * @memberof ReplicaData
   */
  kind: string;
  /**
   *
   * @type {ResourceMetadata}
   * @memberof ReplicaData
   */
  metadata: ResourceMetadata;
  /**
   *
   * @type {string}
   * @memberof ReplicaData
   */
  cluster_id: string;
  /**
   *
   * @type {string}
   * @memberof ReplicaData
   */
  topic_name: string;
  /**
   *
   * @type {number}
   * @memberof ReplicaData
   */
  partition_id: number;
  /**
   *
   * @type {number}
   * @memberof ReplicaData
   */
  broker_id: number;
  /**
   *
   * @type {boolean}
   * @memberof ReplicaData
   */
  is_leader: boolean;
  /**
   *
   * @type {boolean}
   * @memberof ReplicaData
   */
  is_in_sync: boolean;
  /**
   *
   * @type {Relationship}
   * @memberof ReplicaData
   */
  broker: Relationship;
}

/**
 * Check if a given object implements the ReplicaData interface.
 */
export function instanceOfReplicaData(value: object): value is ReplicaData {
  if (!("kind" in value) || value["kind"] === undefined) return false;
  if (!("metadata" in value) || value["metadata"] === undefined) return false;
  if (!("cluster_id" in value) || value["cluster_id"] === undefined) return false;
  if (!("topic_name" in value) || value["topic_name"] === undefined) return false;
  if (!("partition_id" in value) || value["partition_id"] === undefined) return false;
  if (!("broker_id" in value) || value["broker_id"] === undefined) return false;
  if (!("is_leader" in value) || value["is_leader"] === undefined) return false;
  if (!("is_in_sync" in value) || value["is_in_sync"] === undefined) return false;
  if (!("broker" in value) || value["broker"] === undefined) return false;
  return true;
}

export function ReplicaDataFromJSON(json: any): ReplicaData {
  return ReplicaDataFromJSONTyped(json, false);
}

export function ReplicaDataFromJSONTyped(json: any, ignoreDiscriminator: boolean): ReplicaData {
  if (json == null) {
    return json;
  }
  return {
    kind: json["kind"],
    metadata: ResourceMetadataFromJSON(json["metadata"]),
    cluster_id: json["cluster_id"],
    topic_name: json["topic_name"],
    partition_id: json["partition_id"],
    broker_id: json["broker_id"],
    is_leader: json["is_leader"],
    is_in_sync: json["is_in_sync"],
    broker: RelationshipFromJSON(json["broker"]),
  };
}

export function ReplicaDataToJSON(value?: ReplicaData | null): any {
  if (value == null) {
    return value;
  }
  return {
    kind: value["kind"],
    metadata: ResourceMetadataToJSON(value["metadata"]),
    cluster_id: value["cluster_id"],
    topic_name: value["topic_name"],
    partition_id: value["partition_id"],
    broker_id: value["broker_id"],
    is_leader: value["is_leader"],
    is_in_sync: value["is_in_sync"],
    broker: RelationshipToJSON(value["broker"]),
  };
}
