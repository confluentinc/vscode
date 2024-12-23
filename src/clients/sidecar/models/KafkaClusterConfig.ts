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
import type { KafkaClusterConfigCredentials } from "./KafkaClusterConfigCredentials";
import {
  KafkaClusterConfigCredentialsFromJSON,
  KafkaClusterConfigCredentialsFromJSONTyped,
  KafkaClusterConfigCredentialsToJSON,
  KafkaClusterConfigCredentialsToJSONTyped,
} from "./KafkaClusterConfigCredentials";

/**
 * Kafka cluster configuration.
 * @export
 * @interface KafkaClusterConfig
 */
export interface KafkaClusterConfig {
  /**
   * A list of host/port pairs to use for establishing the initial connection to the Kafka cluster.
   * @type {string}
   * @memberof KafkaClusterConfig
   */
  bootstrap_servers: string;
  /**
   *
   * @type {KafkaClusterConfigCredentials}
   * @memberof KafkaClusterConfig
   */
  credentials?: KafkaClusterConfigCredentials | null;
  /**
   * Whether to communicate with the Kafka cluster over TLS/SSL. Defaults to 'true', but set to 'false' when the Kafka cluster does not support TLS/SSL.
   * @type {boolean}
   * @memberof KafkaClusterConfig
   */
  ssl?: boolean | null;
  /**
   * Whether to verify the Kafka cluster certificates. Defaults to 'true', but set to 'false' when the Kafka cluster has self-signed certificates.
   * @type {boolean}
   * @memberof KafkaClusterConfig
   */
  verify_ssl_certificates?: boolean | null;
}

/**
 * Check if a given object implements the KafkaClusterConfig interface.
 */
export function instanceOfKafkaClusterConfig(value: object): value is KafkaClusterConfig {
  if (!("bootstrap_servers" in value) || value["bootstrap_servers"] === undefined) return false;
  return true;
}

export function KafkaClusterConfigFromJSON(json: any): KafkaClusterConfig {
  return KafkaClusterConfigFromJSONTyped(json, false);
}

export function KafkaClusterConfigFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): KafkaClusterConfig {
  if (json == null) {
    return json;
  }
  return {
    bootstrap_servers: json["bootstrap_servers"],
    credentials:
      json["credentials"] == null
        ? undefined
        : KafkaClusterConfigCredentialsFromJSON(json["credentials"]),
    ssl: json["ssl"] == null ? undefined : json["ssl"],
    verify_ssl_certificates:
      json["verify_ssl_certificates"] == null ? undefined : json["verify_ssl_certificates"],
  };
}

export function KafkaClusterConfigToJSON(json: any): KafkaClusterConfig {
  return KafkaClusterConfigToJSONTyped(json, false);
}

export function KafkaClusterConfigToJSONTyped(
  value?: KafkaClusterConfig | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    bootstrap_servers: value["bootstrap_servers"],
    credentials: KafkaClusterConfigCredentialsToJSON(value["credentials"]),
    ssl: value["ssl"],
    verify_ssl_certificates: value["verify_ssl_certificates"],
  };
}
