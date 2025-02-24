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
/**
 *
 * @export
 * @interface Scope
 */
export interface Scope {
  /**
   *
   * @type {{ [key: string]: string; }}
   * @memberof Scope
   */
  clusters?: { [key: string]: string };
  /**
   *
   * @type {Array<string>}
   * @memberof Scope
   */
  path?: Array<string>;
}

/**
 * Check if a given object implements the Scope interface.
 */
export function instanceOfScope(value: object): value is Scope {
  return true;
}

export function ScopeFromJSON(json: any): Scope {
  return ScopeFromJSONTyped(json, false);
}

export function ScopeFromJSONTyped(json: any, ignoreDiscriminator: boolean): Scope {
  if (json == null) {
    return json;
  }
  return {
    clusters: json["clusters"] == null ? undefined : json["clusters"],
    path: json["path"] == null ? undefined : json["path"],
  };
}

export function ScopeToJSON(json: any): Scope {
  return ScopeToJSONTyped(json, false);
}

export function ScopeToJSONTyped(value?: Scope | null, ignoreDiscriminator: boolean = false): any {
  if (value == null) {
    return value;
  }

  return {
    clusters: value["clusters"],
    path: value["path"],
  };
}
