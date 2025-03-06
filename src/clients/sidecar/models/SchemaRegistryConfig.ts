/* tslint:disable */
/* eslint-disable */
/**
 * Confluent ide-sidecar API
 * API for the Confluent ide-sidecar, part of Confluent for VS Code
 *
 * The version of the OpenAPI document: 0.166.0
 * Contact: vscode@confluent.io
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */

import { mapValues } from "../runtime";
import type { TLSConfig } from "./TLSConfig";
import {
  TLSConfigFromJSON,
  TLSConfigFromJSONTyped,
  TLSConfigToJSON,
  TLSConfigToJSONTyped,
} from "./TLSConfig";
import type { SchemaRegistryConfigCredentials } from "./SchemaRegistryConfigCredentials";
import {
  SchemaRegistryConfigCredentialsFromJSON,
  SchemaRegistryConfigCredentialsFromJSONTyped,
  SchemaRegistryConfigCredentialsToJSON,
  SchemaRegistryConfigCredentialsToJSONTyped,
} from "./SchemaRegistryConfigCredentials";

/**
 * Schema Registry configuration.
 * @export
 * @interface SchemaRegistryConfig
 */
export interface SchemaRegistryConfig {
  /**
   * The identifier of the Schema Registry cluster, if known.
   * @type {string}
   * @memberof SchemaRegistryConfig
   */
  id?: string;
  /**
   * The URL of the Schema Registry.
   * @type {string}
   * @memberof SchemaRegistryConfig
   */
  uri: string;
  /**
   *
   * @type {SchemaRegistryConfigCredentials}
   * @memberof SchemaRegistryConfig
   */
  credentials?: SchemaRegistryConfigCredentials | null;
  /**
   * The SSL configuration for connecting to Schema Registry. If null, the connection will use SSL with the default settings. To disable, set `enabled` to false.
   * @type {TLSConfig}
   * @memberof SchemaRegistryConfig
   */
  ssl?: TLSConfig | null;
}

/**
 * Check if a given object implements the SchemaRegistryConfig interface.
 */
export function instanceOfSchemaRegistryConfig(value: object): value is SchemaRegistryConfig {
  if (!("uri" in value) || value["uri"] === undefined) return false;
  return true;
}

export function SchemaRegistryConfigFromJSON(json: any): SchemaRegistryConfig {
  return SchemaRegistryConfigFromJSONTyped(json, false);
}

export function SchemaRegistryConfigFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): SchemaRegistryConfig {
  if (json == null) {
    return json;
  }
  return {
    id: json["id"] == null ? undefined : json["id"],
    uri: json["uri"],
    credentials:
      json["credentials"] == null
        ? undefined
        : SchemaRegistryConfigCredentialsFromJSON(json["credentials"]),
    ssl: json["ssl"] == null ? undefined : TLSConfigFromJSON(json["ssl"]),
  };
}

export function SchemaRegistryConfigToJSON(json: any): SchemaRegistryConfig {
  return SchemaRegistryConfigToJSONTyped(json, false);
}

export function SchemaRegistryConfigToJSONTyped(
  value?: SchemaRegistryConfig | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    id: value["id"],
    uri: value["uri"],
    credentials: SchemaRegistryConfigCredentialsToJSON(value["credentials"]),
    ssl: TLSConfigToJSON(value["ssl"]),
  };
}
