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
/**
 * Provides overall information about problems encountered while performing an operation.
 * @export
 * @interface Failure
 */
export interface Failure {
  /**
   *
   * @type {string}
   * @memberof Failure
   */
  status?: string;
  /**
   *
   * @type {string}
   * @memberof Failure
   */
  code?: string;
  /**
   *
   * @type {string}
   * @memberof Failure
   */
  title?: string;
  /**
   *
   * @type {string}
   * @memberof Failure
   */
  id?: string;
  /**
   *
   * @type {Array<Error>}
   * @memberof Failure
   */
  errors?: Array<Error>;
}

/**
 * Check if a given object implements the Failure interface.
 */
export function instanceOfFailure(value: object): value is Failure {
  return true;
}

export function FailureFromJSON(json: any): Failure {
  return FailureFromJSONTyped(json, false);
}

export function FailureFromJSONTyped(json: any, ignoreDiscriminator: boolean): Failure {
  if (json == null) {
    return json;
  }
  return {
    status: json["status"] == null ? undefined : json["status"],
    code: json["code"] == null ? undefined : json["code"],
    title: json["title"] == null ? undefined : json["title"],
    id: json["id"] == null ? undefined : json["id"],
    errors: json["errors"] == null ? undefined : json["errors"],
  };
}

export function FailureToJSON(json: any): Failure {
  return FailureToJSONTyped(json, false);
}

export function FailureToJSONTyped(
  value?: Failure | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    status: value["status"],
    code: value["code"],
    title: value["title"],
    id: value["id"],
    errors: value["errors"],
  };
}
