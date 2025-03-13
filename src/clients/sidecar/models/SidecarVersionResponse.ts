/* tslint:disable */
/* eslint-disable */
/**
 * Confluent ide-sidecar API
 * API for the Confluent ide-sidecar, part of Confluent for VS Code
 *
 * The version of the OpenAPI document: 0.174.0
 * Contact: vscode@confluent.io
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */

import { mapValues } from "../runtime";
/**
 *
 * @export
 * @interface SidecarVersionResponse
 */
export interface SidecarVersionResponse {
  /**
   *
   * @type {string}
   * @memberof SidecarVersionResponse
   */
  version?: string;
}

/**
 * Check if a given object implements the SidecarVersionResponse interface.
 */
export function instanceOfSidecarVersionResponse(value: object): value is SidecarVersionResponse {
  return true;
}

export function SidecarVersionResponseFromJSON(json: any): SidecarVersionResponse {
  return SidecarVersionResponseFromJSONTyped(json, false);
}

export function SidecarVersionResponseFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): SidecarVersionResponse {
  if (json == null) {
    return json;
  }
  return {
    version: json["version"] == null ? undefined : json["version"],
  };
}

export function SidecarVersionResponseToJSON(json: any): SidecarVersionResponse {
  return SidecarVersionResponseToJSONTyped(json, false);
}

export function SidecarVersionResponseToJSONTyped(
  value?: SidecarVersionResponse | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    version: value["version"],
  };
}
