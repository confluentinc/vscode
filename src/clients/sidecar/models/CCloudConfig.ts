/* tslint:disable */
/* eslint-disable */
/**
 * Confluent ide-sidecar API
 * API for the Confluent ide-sidecar, part of Confluent for VS Code
 *
 * The version of the OpenAPI document: 0.225.0
 * Contact: vscode@confluent.io
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */

import { mapValues } from "../runtime";
/**
 * Configuration for Confluent Cloud connections
 * @export
 * @interface CCloudConfig
 */
export interface CCloudConfig {
  /**
   * The identifier of the CCloud organization to use. The user's default organization is used when absent.
   * @type {string}
   * @memberof CCloudConfig
   */
  organization_id?: string;
  /**
   * The URI that users will be redirected to after successfully completing the authentication flow with Confluent Cloud.
   * @type {string}
   * @memberof CCloudConfig
   */
  ide_auth_callback_uri?: string;
}

/**
 * Check if a given object implements the CCloudConfig interface.
 */
export function instanceOfCCloudConfig(value: object): value is CCloudConfig {
  return true;
}

export function CCloudConfigFromJSON(json: any): CCloudConfig {
  return CCloudConfigFromJSONTyped(json, false);
}

export function CCloudConfigFromJSONTyped(json: any, ignoreDiscriminator: boolean): CCloudConfig {
  if (json == null) {
    return json;
  }
  return {
    organization_id: json["organization_id"] == null ? undefined : json["organization_id"],
    ide_auth_callback_uri:
      json["ide_auth_callback_uri"] == null ? undefined : json["ide_auth_callback_uri"],
  };
}

export function CCloudConfigToJSON(json: any): CCloudConfig {
  return CCloudConfigToJSONTyped(json, false);
}

export function CCloudConfigToJSONTyped(
  value?: CCloudConfig | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    organization_id: value["organization_id"],
    ide_auth_callback_uri: value["ide_auth_callback_uri"],
  };
}
