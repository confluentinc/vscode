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
import type { CreateTopicRequestDataConfigsInner } from "./CreateTopicRequestDataConfigsInner";
import {
  CreateTopicRequestDataConfigsInnerFromJSON,
  CreateTopicRequestDataConfigsInnerFromJSONTyped,
  CreateTopicRequestDataConfigsInnerToJSON,
  CreateTopicRequestDataConfigsInnerToJSONTyped,
} from "./CreateTopicRequestDataConfigsInner";

/**
 *
 * @export
 * @interface CreateTopicRequestData
 */
export interface CreateTopicRequestData {
  /**
   *
   * @type {string}
   * @memberof CreateTopicRequestData
   */
  topic_name: string;
  /**
   *
   * @type {number}
   * @memberof CreateTopicRequestData
   */
  partitions_count?: number;
  /**
   *
   * @type {number}
   * @memberof CreateTopicRequestData
   */
  replication_factor?: number;
  /**
   *
   * @type {Array<CreateTopicRequestDataConfigsInner>}
   * @memberof CreateTopicRequestData
   */
  configs?: Array<CreateTopicRequestDataConfigsInner>;
  /**
   *
   * @type {boolean}
   * @memberof CreateTopicRequestData
   */
  validate_only?: boolean;
}

/**
 * Check if a given object implements the CreateTopicRequestData interface.
 */
export function instanceOfCreateTopicRequestData(value: object): value is CreateTopicRequestData {
  if (!("topic_name" in value) || value["topic_name"] === undefined) return false;
  return true;
}

export function CreateTopicRequestDataFromJSON(json: any): CreateTopicRequestData {
  return CreateTopicRequestDataFromJSONTyped(json, false);
}

export function CreateTopicRequestDataFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): CreateTopicRequestData {
  if (json == null) {
    return json;
  }
  return {
    topic_name: json["topic_name"],
    partitions_count: json["partitions_count"] == null ? undefined : json["partitions_count"],
    replication_factor: json["replication_factor"] == null ? undefined : json["replication_factor"],
    configs:
      json["configs"] == null
        ? undefined
        : (json["configs"] as Array<any>).map(CreateTopicRequestDataConfigsInnerFromJSON),
    validate_only: json["validate_only"] == null ? undefined : json["validate_only"],
  };
}

export function CreateTopicRequestDataToJSON(json: any): CreateTopicRequestData {
  return CreateTopicRequestDataToJSONTyped(json, false);
}

export function CreateTopicRequestDataToJSONTyped(
  value?: CreateTopicRequestData | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    topic_name: value["topic_name"],
    partitions_count: value["partitions_count"],
    replication_factor: value["replication_factor"],
    configs:
      value["configs"] == null
        ? undefined
        : (value["configs"] as Array<any>).map(CreateTopicRequestDataConfigsInnerToJSON),
    validate_only: value["validate_only"],
  };
}
