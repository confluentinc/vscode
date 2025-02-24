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
import type { Scope } from "./Scope";
import { ScopeFromJSON, ScopeFromJSONTyped, ScopeToJSON, ScopeToJSONTyped } from "./Scope";

/**
 *
 * @export
 * @interface Action
 */
export interface Action {
  /**
   *
   * @type {string}
   * @memberof Action
   */
  resourceType?: string;
  /**
   *
   * @type {string}
   * @memberof Action
   */
  resourceName?: string;
  /**
   *
   * @type {string}
   * @memberof Action
   */
  operation?: string;
  /**
   *
   * @type {Scope}
   * @memberof Action
   */
  scope?: Scope;
}

/**
 * Check if a given object implements the Action interface.
 */
export function instanceOfAction(value: object): value is Action {
  return true;
}

export function ActionFromJSON(json: any): Action {
  return ActionFromJSONTyped(json, false);
}

export function ActionFromJSONTyped(json: any, ignoreDiscriminator: boolean): Action {
  if (json == null) {
    return json;
  }
  return {
    resourceType: json["resourceType"] == null ? undefined : json["resourceType"],
    resourceName: json["resourceName"] == null ? undefined : json["resourceName"],
    operation: json["operation"] == null ? undefined : json["operation"],
    scope: json["scope"] == null ? undefined : ScopeFromJSON(json["scope"]),
  };
}

export function ActionToJSON(json: any): Action {
  return ActionToJSONTyped(json, false);
}

export function ActionToJSONTyped(
  value?: Action | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    resourceType: value["resourceType"],
    resourceName: value["resourceName"],
    operation: value["operation"],
    scope: ScopeToJSON(value["scope"]),
  };
}
