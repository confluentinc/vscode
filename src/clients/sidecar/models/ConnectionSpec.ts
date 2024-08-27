/* tslint:disable */
/* eslint-disable */
/**
 * Confluent ide-sidecar API
 * API for the Confluent ide-sidecar, part of the Confluent extension for VS Code
 *
 * The version of the OpenAPI document: 1.0.1
 * Contact: vscode@confluent.io
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */

import { mapValues } from "../runtime";
import type { ConnectionType } from "./ConnectionType";
import {
  ConnectionTypeFromJSON,
  ConnectionTypeFromJSONTyped,
  ConnectionTypeToJSON,
} from "./ConnectionType";
import type { CCloudConfig } from "./CCloudConfig";
import {
  CCloudConfigFromJSON,
  CCloudConfigFromJSONTyped,
  CCloudConfigToJSON,
} from "./CCloudConfig";

/**
 *
 * @export
 * @interface ConnectionSpec
 */
export interface ConnectionSpec {
  /**
   *
   * @type {string}
   * @memberof ConnectionSpec
   */
  id?: string;
  /**
   *
   * @type {string}
   * @memberof ConnectionSpec
   */
  name?: string;
  /**
   *
   * @type {ConnectionType}
   * @memberof ConnectionSpec
   */
  type?: ConnectionType;
  /**
   *
   * @type {CCloudConfig}
   * @memberof ConnectionSpec
   */
  ccloud_config?: CCloudConfig;
}

/**
 * Check if a given object implements the ConnectionSpec interface.
 */
export function instanceOfConnectionSpec(value: object): value is ConnectionSpec {
  return true;
}

export function ConnectionSpecFromJSON(json: any): ConnectionSpec {
  return ConnectionSpecFromJSONTyped(json, false);
}

export function ConnectionSpecFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): ConnectionSpec {
  if (json == null) {
    return json;
  }
  return {
    id: json["id"] == null ? undefined : json["id"],
    name: json["name"] == null ? undefined : json["name"],
    type: json["type"] == null ? undefined : ConnectionTypeFromJSON(json["type"]),
    ccloud_config:
      json["ccloud_config"] == null ? undefined : CCloudConfigFromJSON(json["ccloud_config"]),
  };
}

export function ConnectionSpecToJSON(value?: ConnectionSpec | null): any {
  if (value == null) {
    return value;
  }
  return {
    id: value["id"],
    name: value["name"],
    type: ConnectionTypeToJSON(value["type"]),
    ccloud_config: CCloudConfigToJSON(value["ccloud_config"]),
  };
}
