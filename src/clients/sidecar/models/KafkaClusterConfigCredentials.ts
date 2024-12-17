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

import type { ApiKeyAndSecret } from "./ApiKeyAndSecret";
import {
  instanceOfApiKeyAndSecret,
  ApiKeyAndSecretFromJSON,
  ApiKeyAndSecretFromJSONTyped,
  ApiKeyAndSecretToJSON,
} from "./ApiKeyAndSecret";
import type { BasicCredentials } from "./BasicCredentials";
import {
  instanceOfBasicCredentials,
  BasicCredentialsFromJSON,
  BasicCredentialsFromJSONTyped,
  BasicCredentialsToJSON,
} from "./BasicCredentials";

/**
 * @type KafkaClusterConfigCredentials
 * The credentials for the Kafka cluster, or null if no authentication is required
 * @export
 */
export type KafkaClusterConfigCredentials = ApiKeyAndSecret | BasicCredentials;

export function KafkaClusterConfigCredentialsFromJSON(json: any): KafkaClusterConfigCredentials {
  return KafkaClusterConfigCredentialsFromJSONTyped(json, false);
}

export function KafkaClusterConfigCredentialsFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): KafkaClusterConfigCredentials {
  if (json == null) {
    return json;
  }
  if (instanceOfApiKeyAndSecret(json)) {
    return ApiKeyAndSecretFromJSONTyped(json, true);
  }
  if (instanceOfBasicCredentials(json)) {
    return BasicCredentialsFromJSONTyped(json, true);
  }
}

export function KafkaClusterConfigCredentialsToJSON(
  value?: KafkaClusterConfigCredentials | null,
): any {
  if (value == null) {
    return value;
  }

  if (instanceOfApiKeyAndSecret(value)) {
    return ApiKeyAndSecretToJSON(value as ApiKeyAndSecret);
  }
  if (instanceOfBasicCredentials(value)) {
    return BasicCredentialsToJSON(value as BasicCredentials);
  }

  return {};
}
