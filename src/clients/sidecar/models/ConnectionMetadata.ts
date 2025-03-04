/* tslint:disable */
/* eslint-disable */
/**
 * Confluent ide-sidecar API
 * API for the Confluent ide-sidecar, part of Confluent for VS Code
 *
 * The version of the OpenAPI document: 0.164.0
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
 * @interface ConnectionMetadata
 */
export interface ConnectionMetadata {
  /**
   *
   * @type {string}
   * @memberof ConnectionMetadata
   */
  self?: string;
  /**
   *
   * @type {string}
   * @memberof ConnectionMetadata
   */
  resource_name?: string;
  /**
   *
   * @type {string}
   * @memberof ConnectionMetadata
   */
  sign_in_uri?: string;
}

/**
 * Check if a given object implements the ConnectionMetadata interface.
 */
export function instanceOfConnectionMetadata(value: object): value is ConnectionMetadata {
  return true;
}

export function ConnectionMetadataFromJSON(json: any): ConnectionMetadata {
  return ConnectionMetadataFromJSONTyped(json, false);
}

export function ConnectionMetadataFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): ConnectionMetadata {
  if (json == null) {
    return json;
  }
  return {
    self: json["self"] == null ? undefined : json["self"],
    resource_name: json["resource_name"] == null ? undefined : json["resource_name"],
    sign_in_uri: json["sign_in_uri"] == null ? undefined : json["sign_in_uri"],
  };
}

export function ConnectionMetadataToJSON(json: any): ConnectionMetadata {
  return ConnectionMetadataToJSONTyped(json, false);
}

export function ConnectionMetadataToJSONTyped(
  value?: ConnectionMetadata | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    self: value["self"],
    resource_name: value["resource_name"],
    sign_in_uri: value["sign_in_uri"],
  };
}
