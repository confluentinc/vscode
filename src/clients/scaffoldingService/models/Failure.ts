/* tslint:disable */
/* eslint-disable */
/**
 * Scaffolding API
 * The Scaffolding Service exposes collections of templates that can be applied to generate application projects.
 *
 * The version of the OpenAPI document: 0.0.1
 * Contact: dtx-eng@confluent.io
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */

import { mapValues } from "../runtime";
/**
 * Provides information about problems encountered while performing an operation.
 * @export
 * @interface Failure
 */
export interface Failure {
  /**
   * List of errors which caused this operation to fail
   * @type {Set<Error>}
   * @memberof Failure
   */
  errors: Set<Error>;
}

/**
 * Check if a given object implements the Failure interface.
 */
export function instanceOfFailure(value: object): value is Failure {
  if (!("errors" in value) || value["errors"] === undefined) return false;
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
    errors: new Set(json["errors"]),
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
    errors: Array.from(value["errors"] as Set<any>),
  };
}
