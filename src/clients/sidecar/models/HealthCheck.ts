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
/**
 *
 * @export
 * @interface HealthCheck
 */
export interface HealthCheck {
  /**
   *
   * @type {string}
   * @memberof HealthCheck
   */
  name?: string;
  /**
   *
   * @type {object}
   * @memberof HealthCheck
   */
  data?: object | null;
  /**
   *
   * @type {string}
   * @memberof HealthCheck
   */
  status?: HealthCheckStatusEnum;
}

/**
 * @export
 */
export const HealthCheckStatusEnum = {
  Up: "UP",
  Down: "DOWN",
} as const;
export type HealthCheckStatusEnum =
  (typeof HealthCheckStatusEnum)[keyof typeof HealthCheckStatusEnum];

/**
 * Check if a given object implements the HealthCheck interface.
 */
export function instanceOfHealthCheck(value: object): value is HealthCheck {
  return true;
}

export function HealthCheckFromJSON(json: any): HealthCheck {
  return HealthCheckFromJSONTyped(json, false);
}

export function HealthCheckFromJSONTyped(json: any, ignoreDiscriminator: boolean): HealthCheck {
  if (json == null) {
    return json;
  }
  return {
    name: json["name"] == null ? undefined : json["name"],
    data: json["data"] == null ? undefined : json["data"],
    status: json["status"] == null ? undefined : json["status"],
  };
}

export function HealthCheckToJSON(json: any): HealthCheck {
  return HealthCheckToJSONTyped(json, false);
}

export function HealthCheckToJSONTyped(
  value?: HealthCheck | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    name: value["name"],
    data: value["data"],
    status: value["status"],
  };
}
