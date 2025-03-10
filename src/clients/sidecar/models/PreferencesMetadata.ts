/* tslint:disable */
/* eslint-disable */
/**
 * Confluent ide-sidecar API
 * API for the Confluent ide-sidecar, part of Confluent for VS Code
 *
 * The version of the OpenAPI document: 0.168.0
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
 * @interface PreferencesMetadata
 */
export interface PreferencesMetadata {
  /**
   *
   * @type {string}
   * @memberof PreferencesMetadata
   */
  self: string;
}

/**
 * Check if a given object implements the PreferencesMetadata interface.
 */
export function instanceOfPreferencesMetadata(value: object): value is PreferencesMetadata {
  if (!("self" in value) || value["self"] === undefined) return false;
  return true;
}

export function PreferencesMetadataFromJSON(json: any): PreferencesMetadata {
  return PreferencesMetadataFromJSONTyped(json, false);
}

export function PreferencesMetadataFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): PreferencesMetadata {
  if (json == null) {
    return json;
  }
  return {
    self: json["self"],
  };
}

export function PreferencesMetadataToJSON(json: any): PreferencesMetadata {
  return PreferencesMetadataToJSONTyped(json, false);
}

export function PreferencesMetadataToJSONTyped(
  value?: PreferencesMetadata | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    self: value["self"],
  };
}
