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
import type { MirrorLag } from "./MirrorLag";
import {
  MirrorLagFromJSON,
  MirrorLagFromJSONTyped,
  MirrorLagToJSON,
  MirrorLagToJSONTyped,
} from "./MirrorLag";
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
 * @interface AlterMirrorStatusResponseData
 */
export interface AlterMirrorStatusResponseData {
  /**
   *
   * @type {string}
   * @memberof AlterMirrorStatusResponseData
   */
  kind: string;
  /**
   *
   * @type {ResourceMetadata}
   * @memberof AlterMirrorStatusResponseData
   */
  metadata: ResourceMetadata;
  /**
   *
   * @type {string}
   * @memberof AlterMirrorStatusResponseData
   */
  mirror_topic_name: string;
  /**
   *
   * @type {string}
   * @memberof AlterMirrorStatusResponseData
   */
  error_message: string | null;
  /**
   *
   * @type {number}
   * @memberof AlterMirrorStatusResponseData
   */
  error_code: number | null;
  /**
   *
   * @type {Array<MirrorLag>}
   * @memberof AlterMirrorStatusResponseData
   */
  mirror_lags: Array<MirrorLag>;
}

/**
 * Check if a given object implements the AlterMirrorStatusResponseData interface.
 */
export function instanceOfAlterMirrorStatusResponseData(
  value: object,
): value is AlterMirrorStatusResponseData {
  if (!("kind" in value) || value["kind"] === undefined) return false;
  if (!("metadata" in value) || value["metadata"] === undefined) return false;
  if (!("mirror_topic_name" in value) || value["mirror_topic_name"] === undefined) return false;
  if (!("error_message" in value) || value["error_message"] === undefined) return false;
  if (!("error_code" in value) || value["error_code"] === undefined) return false;
  if (!("mirror_lags" in value) || value["mirror_lags"] === undefined) return false;
  return true;
}

export function AlterMirrorStatusResponseDataFromJSON(json: any): AlterMirrorStatusResponseData {
  return AlterMirrorStatusResponseDataFromJSONTyped(json, false);
}

export function AlterMirrorStatusResponseDataFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): AlterMirrorStatusResponseData {
  if (json == null) {
    return json;
  }
  return {
    kind: json["kind"],
    metadata: ResourceMetadataFromJSON(json["metadata"]),
    mirror_topic_name: json["mirror_topic_name"],
    error_message: json["error_message"],
    error_code: json["error_code"],
    mirror_lags: (json["mirror_lags"] as Array<any>).map(MirrorLagFromJSON),
  };
}

export function AlterMirrorStatusResponseDataToJSON(json: any): AlterMirrorStatusResponseData {
  return AlterMirrorStatusResponseDataToJSONTyped(json, false);
}

export function AlterMirrorStatusResponseDataToJSONTyped(
  value?: AlterMirrorStatusResponseData | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    kind: value["kind"],
    metadata: ResourceMetadataToJSON(value["metadata"]),
    mirror_topic_name: value["mirror_topic_name"],
    error_message: value["error_message"],
    error_code: value["error_code"],
    mirror_lags: (value["mirror_lags"] as Array<any>).map(MirrorLagToJSON),
  };
}
