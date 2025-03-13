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
 * @interface PreferencesSpec
 */
export interface PreferencesSpec {
  /**
   *
   * @type {Array<string>}
   * @memberof PreferencesSpec
   */
  tls_pem_paths?: Array<string>;
  /**
   *
   * @type {boolean}
   * @memberof PreferencesSpec
   */
  trust_all_certificates?: boolean;
}

/**
 * Check if a given object implements the PreferencesSpec interface.
 */
export function instanceOfPreferencesSpec(value: object): value is PreferencesSpec {
  return true;
}

export function PreferencesSpecFromJSON(json: any): PreferencesSpec {
  return PreferencesSpecFromJSONTyped(json, false);
}

export function PreferencesSpecFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): PreferencesSpec {
  if (json == null) {
    return json;
  }
  return {
    tls_pem_paths: json["tls_pem_paths"] == null ? undefined : json["tls_pem_paths"],
    trust_all_certificates:
      json["trust_all_certificates"] == null ? undefined : json["trust_all_certificates"],
  };
}

export function PreferencesSpecToJSON(json: any): PreferencesSpec {
  return PreferencesSpecToJSONTyped(json, false);
}

export function PreferencesSpecToJSONTyped(
  value?: PreferencesSpec | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    tls_pem_paths: value["tls_pem_paths"],
    trust_all_certificates: value["trust_all_certificates"],
  };
}
