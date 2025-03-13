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
import type { ConnectionSpec } from "./ConnectionSpec";
import {
  ConnectionSpecFromJSON,
  ConnectionSpecFromJSONTyped,
  ConnectionSpecToJSON,
  ConnectionSpecToJSONTyped,
} from "./ConnectionSpec";
import type { ConnectionMetadata } from "./ConnectionMetadata";
import {
  ConnectionMetadataFromJSON,
  ConnectionMetadataFromJSONTyped,
  ConnectionMetadataToJSON,
  ConnectionMetadataToJSONTyped,
} from "./ConnectionMetadata";
import type { ConnectionStatus } from "./ConnectionStatus";
import {
  ConnectionStatusFromJSON,
  ConnectionStatusFromJSONTyped,
  ConnectionStatusToJSON,
  ConnectionStatusToJSONTyped,
} from "./ConnectionStatus";

/**
 *
 * @export
 * @interface Connection
 */
export interface Connection {
  /**
   *
   * @type {string}
   * @memberof Connection
   */
  api_version: string;
  /**
   *
   * @type {string}
   * @memberof Connection
   */
  kind: string;
  /**
   *
   * @type {string}
   * @memberof Connection
   */
  id: string;
  /**
   *
   * @type {ConnectionMetadata}
   * @memberof Connection
   */
  metadata: ConnectionMetadata;
  /**
   *
   * @type {ConnectionSpec}
   * @memberof Connection
   */
  spec: ConnectionSpec;
  /**
   *
   * @type {ConnectionStatus}
   * @memberof Connection
   */
  status: ConnectionStatus;
}

/**
 * Check if a given object implements the Connection interface.
 */
export function instanceOfConnection(value: object): value is Connection {
  if (!("api_version" in value) || value["api_version"] === undefined) return false;
  if (!("kind" in value) || value["kind"] === undefined) return false;
  if (!("id" in value) || value["id"] === undefined) return false;
  if (!("metadata" in value) || value["metadata"] === undefined) return false;
  if (!("spec" in value) || value["spec"] === undefined) return false;
  if (!("status" in value) || value["status"] === undefined) return false;
  return true;
}

export function ConnectionFromJSON(json: any): Connection {
  return ConnectionFromJSONTyped(json, false);
}

export function ConnectionFromJSONTyped(json: any, ignoreDiscriminator: boolean): Connection {
  if (json == null) {
    return json;
  }
  return {
    api_version: json["api_version"],
    kind: json["kind"],
    id: json["id"],
    metadata: ConnectionMetadataFromJSON(json["metadata"]),
    spec: ConnectionSpecFromJSON(json["spec"]),
    status: ConnectionStatusFromJSON(json["status"]),
  };
}

export function ConnectionToJSON(json: any): Connection {
  return ConnectionToJSONTyped(json, false);
}

export function ConnectionToJSONTyped(
  value?: Connection | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    api_version: value["api_version"],
    kind: value["kind"],
    id: value["id"],
    metadata: ConnectionMetadataToJSON(value["metadata"]),
    spec: ConnectionSpecToJSON(value["spec"]),
    status: ConnectionStatusToJSON(value["status"]),
  };
}
