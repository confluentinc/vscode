/* tslint:disable */
/* eslint-disable */
/**
 * Confluent ide-sidecar API
 * API for the Confluent ide-sidecar, part of Confluent for VS Code
 *
 * The version of the OpenAPI document: 0.173.0
 * Contact: vscode@confluent.io
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */

import { mapValues } from "../runtime";
import type { ProduceRequestHeader } from "./ProduceRequestHeader";
import {
  ProduceRequestHeaderFromJSON,
  ProduceRequestHeaderFromJSONTyped,
  ProduceRequestHeaderToJSON,
  ProduceRequestHeaderToJSONTyped,
} from "./ProduceRequestHeader";
import type { ProduceRequestData } from "./ProduceRequestData";
import {
  ProduceRequestDataFromJSON,
  ProduceRequestDataFromJSONTyped,
  ProduceRequestDataToJSON,
  ProduceRequestDataToJSONTyped,
} from "./ProduceRequestData";

/**
 *
 * @export
 * @interface ProduceRequest
 */
export interface ProduceRequest {
  /**
   *
   * @type {number}
   * @memberof ProduceRequest
   */
  partition_id?: number;
  /**
   *
   * @type {Array<ProduceRequestHeader>}
   * @memberof ProduceRequest
   */
  headers?: Array<ProduceRequestHeader>;
  /**
   *
   * @type {ProduceRequestData}
   * @memberof ProduceRequest
   */
  key?: ProduceRequestData;
  /**
   *
   * @type {ProduceRequestData}
   * @memberof ProduceRequest
   */
  value?: ProduceRequestData;
  /**
   *
   * @type {Date}
   * @memberof ProduceRequest
   */
  timestamp?: Date;
}

/**
 * Check if a given object implements the ProduceRequest interface.
 */
export function instanceOfProduceRequest(value: object): value is ProduceRequest {
  return true;
}

export function ProduceRequestFromJSON(json: any): ProduceRequest {
  return ProduceRequestFromJSONTyped(json, false);
}

export function ProduceRequestFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): ProduceRequest {
  if (json == null) {
    return json;
  }
  return {
    partition_id: json["partition_id"] == null ? undefined : json["partition_id"],
    headers:
      json["headers"] == null
        ? undefined
        : (json["headers"] as Array<any>).map(ProduceRequestHeaderFromJSON),
    key: json["key"] == null ? undefined : ProduceRequestDataFromJSON(json["key"]),
    value: json["value"] == null ? undefined : ProduceRequestDataFromJSON(json["value"]),
    timestamp: json["timestamp"] == null ? undefined : new Date(json["timestamp"]),
  };
}

export function ProduceRequestToJSON(json: any): ProduceRequest {
  return ProduceRequestToJSONTyped(json, false);
}

export function ProduceRequestToJSONTyped(
  value?: ProduceRequest | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    partition_id: value["partition_id"],
    headers:
      value["headers"] == null
        ? undefined
        : (value["headers"] as Array<any>).map(ProduceRequestHeaderToJSON),
    key: ProduceRequestDataToJSON(value["key"]),
    value: ProduceRequestDataToJSON(value["value"]),
    timestamp:
      value["timestamp"] == null ? undefined : value["timestamp"].toISOString().substring(0, 10),
  };
}
