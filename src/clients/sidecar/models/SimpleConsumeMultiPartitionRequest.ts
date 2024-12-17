/* tslint:disable */
/* eslint-disable */
/**
 * Confluent ide-sidecar API
 * API for the Confluent ide-sidecar, part of Confluent for VS Code
 *
 * The version of the OpenAPI document: 1.0.1
 * Contact: vscode@confluent.io
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */

import { mapValues } from "../runtime";
import type { PartitionOffset } from "./PartitionOffset";
import {
  PartitionOffsetFromJSON,
  PartitionOffsetFromJSONTyped,
  PartitionOffsetToJSON,
  PartitionOffsetToJSONTyped,
} from "./PartitionOffset";

/**
 *
 * @export
 * @interface SimpleConsumeMultiPartitionRequest
 */
export interface SimpleConsumeMultiPartitionRequest {
  /**
   *
   * @type {Array<PartitionOffset>}
   * @memberof SimpleConsumeMultiPartitionRequest
   */
  offsets?: Array<PartitionOffset>;
  /**
   *
   * @type {number}
   * @memberof SimpleConsumeMultiPartitionRequest
   */
  max_poll_records?: number;
  /**
   *
   * @type {number}
   * @memberof SimpleConsumeMultiPartitionRequest
   */
  timestamp?: number;
  /**
   *
   * @type {number}
   * @memberof SimpleConsumeMultiPartitionRequest
   */
  fetch_max_bytes?: number;
  /**
   *
   * @type {number}
   * @memberof SimpleConsumeMultiPartitionRequest
   */
  message_max_bytes?: number;
  /**
   *
   * @type {boolean}
   * @memberof SimpleConsumeMultiPartitionRequest
   */
  from_beginning?: boolean;
}

/**
 * Check if a given object implements the SimpleConsumeMultiPartitionRequest interface.
 */
export function instanceOfSimpleConsumeMultiPartitionRequest(
  value: object,
): value is SimpleConsumeMultiPartitionRequest {
  return true;
}

export function SimpleConsumeMultiPartitionRequestFromJSON(
  json: any,
): SimpleConsumeMultiPartitionRequest {
  return SimpleConsumeMultiPartitionRequestFromJSONTyped(json, false);
}

export function SimpleConsumeMultiPartitionRequestFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): SimpleConsumeMultiPartitionRequest {
  if (json == null) {
    return json;
  }
  return {
    offsets:
      json["offsets"] == null
        ? undefined
        : (json["offsets"] as Array<any>).map(PartitionOffsetFromJSON),
    max_poll_records: json["max_poll_records"] == null ? undefined : json["max_poll_records"],
    timestamp: json["timestamp"] == null ? undefined : json["timestamp"],
    fetch_max_bytes: json["fetch_max_bytes"] == null ? undefined : json["fetch_max_bytes"],
    message_max_bytes: json["message_max_bytes"] == null ? undefined : json["message_max_bytes"],
    from_beginning: json["from_beginning"] == null ? undefined : json["from_beginning"],
  };
}

export function SimpleConsumeMultiPartitionRequestToJSON(
  json: any,
): SimpleConsumeMultiPartitionRequest {
  return SimpleConsumeMultiPartitionRequestToJSONTyped(json, false);
}

export function SimpleConsumeMultiPartitionRequestToJSONTyped(
  value?: SimpleConsumeMultiPartitionRequest | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    offsets:
      value["offsets"] == null
        ? undefined
        : (value["offsets"] as Array<any>).map(PartitionOffsetToJSON),
    max_poll_records: value["max_poll_records"],
    timestamp: value["timestamp"],
    fetch_max_bytes: value["fetch_max_bytes"],
    message_max_bytes: value["message_max_bytes"],
    from_beginning: value["from_beginning"],
  };
}
