/* tslint:disable */
/* eslint-disable */
/**
 * Confluent ide-sidecar API
 * API for the Confluent ide-sidecar, part of Confluent for VS Code
 *
 * The version of the OpenAPI document: 0.168.0
 * Contact: vscode@confluent.io
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */

import { mapValues } from "../runtime";
import type { AuthErrors } from "./AuthErrors";
import {
  AuthErrorsFromJSON,
  AuthErrorsFromJSONTyped,
  AuthErrorsToJSON,
  AuthErrorsToJSONTyped,
} from "./AuthErrors";
import type { ConnectedState } from "./ConnectedState";
import {
  ConnectedStateFromJSON,
  ConnectedStateFromJSONTyped,
  ConnectedStateToJSON,
  ConnectedStateToJSONTyped,
} from "./ConnectedState";
import type { UserInfo } from "./UserInfo";
import {
  UserInfoFromJSON,
  UserInfoFromJSONTyped,
  UserInfoToJSON,
  UserInfoToJSONTyped,
} from "./UserInfo";

/**
 * The status related to CCloud.
 * @export
 * @interface CCloudStatus
 */
export interface CCloudStatus {
  /**
   * The state of the connection to CCloud.
   * @type {ConnectedState}
   * @memberof CCloudStatus
   */
  state: ConnectedState;
  /**
   * If the connection's auth context holds a valid token, this attribute holds the time at which the user must re-authenticate because, for instance, the refresh token reached the end of its absolute lifetime.
   * @type {Date}
   * @memberof CCloudStatus
   */
  requires_authentication_at?: Date;
  /**
   * Information about the authenticated principal, if known.
   * @type {UserInfo}
   * @memberof CCloudStatus
   */
  user?: UserInfo;
  /**
   * Errors related to the connection to the Kafka cluster.
   * @type {AuthErrors}
   * @memberof CCloudStatus
   */
  errors?: AuthErrors;
}

/**
 * Check if a given object implements the CCloudStatus interface.
 */
export function instanceOfCCloudStatus(value: object): value is CCloudStatus {
  if (!("state" in value) || value["state"] === undefined) return false;
  return true;
}

export function CCloudStatusFromJSON(json: any): CCloudStatus {
  return CCloudStatusFromJSONTyped(json, false);
}

export function CCloudStatusFromJSONTyped(json: any, ignoreDiscriminator: boolean): CCloudStatus {
  if (json == null) {
    return json;
  }
  return {
    state: ConnectedStateFromJSON(json["state"]),
    requires_authentication_at:
      json["requires_authentication_at"] == null
        ? undefined
        : new Date(json["requires_authentication_at"]),
    user: json["user"] == null ? undefined : UserInfoFromJSON(json["user"]),
    errors: json["errors"] == null ? undefined : AuthErrorsFromJSON(json["errors"]),
  };
}

export function CCloudStatusToJSON(json: any): CCloudStatus {
  return CCloudStatusToJSONTyped(json, false);
}

export function CCloudStatusToJSONTyped(
  value?: CCloudStatus | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    state: ConnectedStateToJSON(value["state"]),
    requires_authentication_at:
      value["requires_authentication_at"] == null
        ? undefined
        : value["requires_authentication_at"].toISOString(),
    user: UserInfoToJSON(value["user"]),
    errors: AuthErrorsToJSON(value["errors"]),
  };
}
