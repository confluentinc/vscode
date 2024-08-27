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
import type { BrokerTaskType } from "./BrokerTaskType";
import {
  BrokerTaskTypeFromJSON,
  BrokerTaskTypeFromJSONTyped,
  BrokerTaskTypeToJSON,
} from "./BrokerTaskType";
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
 * @interface BrokerTaskData
 */
export interface BrokerTaskData {
  /**
   *
   * @type {string}
   * @memberof BrokerTaskData
   */
  kind: string;
  /**
   *
   * @type {ResourceMetadata}
   * @memberof BrokerTaskData
   */
  metadata: ResourceMetadata;
  /**
   *
   * @type {string}
   * @memberof BrokerTaskData
   */
  cluster_id: string;
  /**
   *
   * @type {number}
   * @memberof BrokerTaskData
   */
  broker_id: number;
  /**
   *
   * @type {BrokerTaskType}
   * @memberof BrokerTaskData
   */
  task_type: BrokerTaskType;
  /**
   *
   * @type {string}
   * @memberof BrokerTaskData
   */
  task_status: string;
  /**
   *
   * @type {boolean}
   * @memberof BrokerTaskData
   */
  shutdown_scheduled?: boolean | null;
  /**
   *
   * @type {{ [key: string]: string; }}
   * @memberof BrokerTaskData
   */
  sub_task_statuses: { [key: string]: string };
  /**
   * The date and time at which this task was created.
   * @type {Date}
   * @memberof BrokerTaskData
   */
  readonly created_at: Date;
  /**
   * The date and time at which this task was last updated.
   * @type {Date}
   * @memberof BrokerTaskData
   */
  readonly updated_at: Date;
  /**
   *
   * @type {number}
   * @memberof BrokerTaskData
   */
  error_code?: number | null;
  /**
   *
   * @type {string}
   * @memberof BrokerTaskData
   */
  error_message?: string | null;
  /**
   *
   * @type {Relationship}
   * @memberof BrokerTaskData
   */
  broker: Relationship;
}

/**
 * Check if a given object implements the BrokerTaskData interface.
 */
export function instanceOfBrokerTaskData(value: object): value is BrokerTaskData {
  if (!("kind" in value) || value["kind"] === undefined) return false;
  if (!("metadata" in value) || value["metadata"] === undefined) return false;
  if (!("cluster_id" in value) || value["cluster_id"] === undefined) return false;
  if (!("broker_id" in value) || value["broker_id"] === undefined) return false;
  if (!("task_type" in value) || value["task_type"] === undefined) return false;
  if (!("task_status" in value) || value["task_status"] === undefined) return false;
  if (!("sub_task_statuses" in value) || value["sub_task_statuses"] === undefined) return false;
  if (!("created_at" in value) || value["created_at"] === undefined) return false;
  if (!("updated_at" in value) || value["updated_at"] === undefined) return false;
  if (!("broker" in value) || value["broker"] === undefined) return false;
  return true;
}

export function BrokerTaskDataFromJSON(json: any): BrokerTaskData {
  return BrokerTaskDataFromJSONTyped(json, false);
}

export function BrokerTaskDataFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): BrokerTaskData {
  if (json == null) {
    return json;
  }
  return {
    kind: json["kind"],
    metadata: ResourceMetadataFromJSON(json["metadata"]),
    cluster_id: json["cluster_id"],
    broker_id: json["broker_id"],
    task_type: BrokerTaskTypeFromJSON(json["task_type"]),
    task_status: json["task_status"],
    shutdown_scheduled: json["shutdown_scheduled"] == null ? undefined : json["shutdown_scheduled"],
    sub_task_statuses: json["sub_task_statuses"],
    created_at: new Date(json["created_at"]),
    updated_at: new Date(json["updated_at"]),
    error_code: json["error_code"] == null ? undefined : json["error_code"],
    error_message: json["error_message"] == null ? undefined : json["error_message"],
    broker: RelationshipFromJSON(json["broker"]),
  };
}

export function BrokerTaskDataToJSON(
  value?: Omit<BrokerTaskData, "created_at" | "updated_at"> | null,
): any {
  if (value == null) {
    return value;
  }
  return {
    kind: value["kind"],
    metadata: ResourceMetadataToJSON(value["metadata"]),
    cluster_id: value["cluster_id"],
    broker_id: value["broker_id"],
    task_type: BrokerTaskTypeToJSON(value["task_type"]),
    task_status: value["task_status"],
    shutdown_scheduled: value["shutdown_scheduled"],
    sub_task_statuses: value["sub_task_statuses"],
    error_code: value["error_code"],
    error_message: value["error_message"],
    broker: RelationshipToJSON(value["broker"]),
  };
}
