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
 *
 * @export
 * @interface AuthError
 */
export interface AuthError {
  /**
   *
   * @type {string}
   * @memberof AuthError
   */
  message?: string;
  /**
   *
   * @type {boolean}
   * @memberof AuthError
   */
  is_transient?: boolean;
}

/**
 * Check if a given object implements the AuthError interface.
 */
export function instanceOfAuthError(value: object): value is AuthError {
  return true;
}

export function AuthErrorFromJSON(json: any): AuthError {
  return AuthErrorFromJSONTyped(json, false);
}

export function AuthErrorFromJSONTyped(json: any, ignoreDiscriminator: boolean): AuthError {
  if (json == null) {
    return json;
  }
  return {
    message: json["message"] == null ? undefined : json["message"],
    is_transient: json["is_transient"] == null ? undefined : json["is_transient"],
  };
}

export function AuthErrorToJSON(json: any): AuthError {
  return AuthErrorToJSONTyped(json, false);
}

export function AuthErrorToJSONTyped(
  value?: AuthError | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    message: value["message"],
    is_transient: value["is_transient"],
  };
}
