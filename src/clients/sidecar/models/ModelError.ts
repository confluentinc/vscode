/* tslint:disable */
/* eslint-disable */
/**
 * Confluent ide-sidecar API
 * API for the Confluent ide-sidecar, part of Confluent for VS Code
 *
 * The version of the OpenAPI document: 0.183.0
 * Contact: vscode@confluent.io
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */

import { mapValues } from "../runtime";
import type { JsonNode } from "./JsonNode";
import {
  JsonNodeFromJSON,
  JsonNodeFromJSONTyped,
  JsonNodeToJSON,
  JsonNodeToJSONTyped,
} from "./JsonNode";

/**
 * Describes a particular error encountered while performing an operation.
 * @export
 * @interface ModelError
 */
export interface ModelError {
  /**
   *
   * @type {string}
   * @memberof ModelError
   */
  code?: string;
  /**
   *
   * @type {string}
   * @memberof ModelError
   */
  status?: string;
  /**
   *
   * @type {string}
   * @memberof ModelError
   */
  title?: string;
  /**
   *
   * @type {string}
   * @memberof ModelError
   */
  id?: string;
  /**
   *
   * @type {string}
   * @memberof ModelError
   */
  detail?: string;
  /**
   *
   * @type {JsonNode}
   * @memberof ModelError
   */
  source?: JsonNode;
}

/**
 * Check if a given object implements the ModelError interface.
 */
export function instanceOfModelError(value: object): value is ModelError {
  return true;
}

export function ModelErrorFromJSON(json: any): ModelError {
  return ModelErrorFromJSONTyped(json, false);
}

export function ModelErrorFromJSONTyped(json: any, ignoreDiscriminator: boolean): ModelError {
  if (json == null) {
    return json;
  }
  return {
    code: json["code"] == null ? undefined : json["code"],
    status: json["status"] == null ? undefined : json["status"],
    title: json["title"] == null ? undefined : json["title"],
    id: json["id"] == null ? undefined : json["id"],
    detail: json["detail"] == null ? undefined : json["detail"],
    source: json["source"] == null ? undefined : JsonNodeFromJSON(json["source"]),
  };
}

export function ModelErrorToJSON(json: any): ModelError {
  return ModelErrorToJSONTyped(json, false);
}

export function ModelErrorToJSONTyped(
  value?: ModelError | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    code: value["code"],
    status: value["status"],
    title: value["title"],
    id: value["id"],
    detail: value["detail"],
    source: JsonNodeToJSON(value["source"]),
  };
}
