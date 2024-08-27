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
 * @interface RemoveBrokerTaskData
 */
export interface RemoveBrokerTaskData {
  /**
   *
   * @type {string}
   * @memberof RemoveBrokerTaskData
   */
  kind: string;
  /**
   *
   * @type {ResourceMetadata}
   * @memberof RemoveBrokerTaskData
   */
  metadata: ResourceMetadata;
  /**
   *
   * @type {string}
   * @memberof RemoveBrokerTaskData
   */
  cluster_id: string;
  /**
   *
   * @type {number}
   * @memberof RemoveBrokerTaskData
   */
  broker_id: number;
  /**
   *
   * @type {boolean}
   * @memberof RemoveBrokerTaskData
   */
  shutdown_scheduled: boolean;
  /**
   *
   * @type {string}
   * @memberof RemoveBrokerTaskData
   */
  broker_replica_exclusion_status: string;
  /**
   *
   * @type {string}
   * @memberof RemoveBrokerTaskData
   */
  partition_reassignment_status: string;
  /**
   *
   * @type {string}
   * @memberof RemoveBrokerTaskData
   */
  broker_shutdown_status: string;
  /**
   *
   * @type {number}
   * @memberof RemoveBrokerTaskData
   */
  error_code?: number | null;
  /**
   *
   * @type {string}
   * @memberof RemoveBrokerTaskData
   */
  error_message?: string | null;
  /**
   *
   * @type {Relationship}
   * @memberof RemoveBrokerTaskData
   */
  broker: Relationship;
}

/**
 * Check if a given object implements the RemoveBrokerTaskData interface.
 */
export function instanceOfRemoveBrokerTaskData(value: object): value is RemoveBrokerTaskData {
  if (!("kind" in value) || value["kind"] === undefined) return false;
  if (!("metadata" in value) || value["metadata"] === undefined) return false;
  if (!("cluster_id" in value) || value["cluster_id"] === undefined) return false;
  if (!("broker_id" in value) || value["broker_id"] === undefined) return false;
  if (!("shutdown_scheduled" in value) || value["shutdown_scheduled"] === undefined) return false;
  if (
    !("broker_replica_exclusion_status" in value) ||
    value["broker_replica_exclusion_status"] === undefined
  )
    return false;
  if (
    !("partition_reassignment_status" in value) ||
    value["partition_reassignment_status"] === undefined
  )
    return false;
  if (!("broker_shutdown_status" in value) || value["broker_shutdown_status"] === undefined)
    return false;
  if (!("broker" in value) || value["broker"] === undefined) return false;
  return true;
}

export function RemoveBrokerTaskDataFromJSON(json: any): RemoveBrokerTaskData {
  return RemoveBrokerTaskDataFromJSONTyped(json, false);
}

export function RemoveBrokerTaskDataFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): RemoveBrokerTaskData {
  if (json == null) {
    return json;
  }
  return {
    kind: json["kind"],
    metadata: ResourceMetadataFromJSON(json["metadata"]),
    cluster_id: json["cluster_id"],
    broker_id: json["broker_id"],
    shutdown_scheduled: json["shutdown_scheduled"],
    broker_replica_exclusion_status: json["broker_replica_exclusion_status"],
    partition_reassignment_status: json["partition_reassignment_status"],
    broker_shutdown_status: json["broker_shutdown_status"],
    error_code: json["error_code"] == null ? undefined : json["error_code"],
    error_message: json["error_message"] == null ? undefined : json["error_message"],
    broker: RelationshipFromJSON(json["broker"]),
  };
}

export function RemoveBrokerTaskDataToJSON(value?: RemoveBrokerTaskData | null): any {
  if (value == null) {
    return value;
  }
  return {
    kind: value["kind"],
    metadata: ResourceMetadataToJSON(value["metadata"]),
    cluster_id: value["cluster_id"],
    broker_id: value["broker_id"],
    shutdown_scheduled: value["shutdown_scheduled"],
    broker_replica_exclusion_status: value["broker_replica_exclusion_status"],
    partition_reassignment_status: value["partition_reassignment_status"],
    broker_shutdown_status: value["broker_shutdown_status"],
    error_code: value["error_code"],
    error_message: value["error_message"],
    broker: RelationshipToJSON(value["broker"]),
  };
}
