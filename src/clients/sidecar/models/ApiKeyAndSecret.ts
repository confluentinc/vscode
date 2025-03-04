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
 * API key and secret authentication credentials
 * @export
 * @interface ApiKeyAndSecret
 */
export interface ApiKeyAndSecret {
  /**
   * The API key to use when connecting to the external service.
   * @type {string}
   * @memberof ApiKeyAndSecret
   */
  api_key: string;
  /**
   * The API secret to use when connecting to the external service.
   * @type {string}
   * @memberof ApiKeyAndSecret
   */
  api_secret: string;
}

/**
 * Check if a given object implements the ApiKeyAndSecret interface.
 */
export function instanceOfApiKeyAndSecret(value: object): value is ApiKeyAndSecret {
  if (!("api_key" in value) || value["api_key"] === undefined) return false;
  if (!("api_secret" in value) || value["api_secret"] === undefined) return false;
  return true;
}

export function ApiKeyAndSecretFromJSON(json: any): ApiKeyAndSecret {
  return ApiKeyAndSecretFromJSONTyped(json, false);
}

export function ApiKeyAndSecretFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): ApiKeyAndSecret {
  if (json == null) {
    return json;
  }
  return {
    api_key: json["api_key"],
    api_secret: json["api_secret"],
  };
}

export function ApiKeyAndSecretToJSON(json: any): ApiKeyAndSecret {
  return ApiKeyAndSecretToJSONTyped(json, false);
}

export function ApiKeyAndSecretToJSONTyped(
  value?: ApiKeyAndSecret | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    api_key: value["api_key"],
    api_secret: value["api_secret"],
  };
}
