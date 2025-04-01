/* tslint:disable */
/* eslint-disable */
/**
 * SQL API v1
 * No description provided (generated by Openapi Generator https://github.com/openapitools/openapi-generator)
 *
 * The version of the OpenAPI document: 0.0.1
 *
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */

import { mapValues } from "../runtime";
import type { SqlV1ConnectionStatus } from "./SqlV1ConnectionStatus";
import {
  SqlV1ConnectionStatusFromJSON,
  SqlV1ConnectionStatusFromJSONTyped,
  SqlV1ConnectionStatusToJSON,
  SqlV1ConnectionStatusToJSONTyped,
} from "./SqlV1ConnectionStatus";
import type { SqlV1ConnectionMetadata } from "./SqlV1ConnectionMetadata";
import {
  SqlV1ConnectionMetadataFromJSON,
  SqlV1ConnectionMetadataFromJSONTyped,
  SqlV1ConnectionMetadataToJSON,
  SqlV1ConnectionMetadataToJSONTyped,
} from "./SqlV1ConnectionMetadata";

/**
 *
 * @export
 * @interface GetSqlv1Connection200Response
 */
export interface GetSqlv1Connection200Response {
  /**
   * APIVersion defines the schema version of this representation of a resource.
   * @type {string}
   * @memberof GetSqlv1Connection200Response
   */
  readonly api_version: GetSqlv1Connection200ResponseApiVersionEnum;
  /**
   * Kind defines the object this REST resource represents.
   * @type {string}
   * @memberof GetSqlv1Connection200Response
   */
  readonly kind: GetSqlv1Connection200ResponseKindEnum;
  /**
   *
   * @type {SqlV1ConnectionMetadata}
   * @memberof GetSqlv1Connection200Response
   */
  metadata: SqlV1ConnectionMetadata;
  /**
   * The user provided name of the resource, unique within this environment.
   * @type {string}
   * @memberof GetSqlv1Connection200Response
   */
  name?: string;
  /**
   *
   * @type {object}
   * @memberof GetSqlv1Connection200Response
   */
  spec: object;
  /**
   *
   * @type {SqlV1ConnectionStatus}
   * @memberof GetSqlv1Connection200Response
   */
  status?: SqlV1ConnectionStatus;
}

/**
 * @export
 * @enum {string}
 */
export enum GetSqlv1Connection200ResponseApiVersionEnum {
  SqlV1 = "sql/v1",
}
/**
 * @export
 * @enum {string}
 */
export enum GetSqlv1Connection200ResponseKindEnum {
  Connection = "Connection",
}

/**
 * Check if a given object implements the GetSqlv1Connection200Response interface.
 */
export function instanceOfGetSqlv1Connection200Response(
  value: object,
): value is GetSqlv1Connection200Response {
  if (!("api_version" in value) || value["api_version"] === undefined) return false;
  if (!("kind" in value) || value["kind"] === undefined) return false;
  if (!("metadata" in value) || value["metadata"] === undefined) return false;
  if (!("spec" in value) || value["spec"] === undefined) return false;
  return true;
}

export function GetSqlv1Connection200ResponseFromJSON(json: any): GetSqlv1Connection200Response {
  return GetSqlv1Connection200ResponseFromJSONTyped(json, false);
}

export function GetSqlv1Connection200ResponseFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): GetSqlv1Connection200Response {
  if (json == null) {
    return json;
  }
  return {
    api_version: json["api_version"],
    kind: json["kind"],
    metadata: SqlV1ConnectionMetadataFromJSON(json["metadata"]),
    name: json["name"] == null ? undefined : json["name"],
    spec: json["spec"],
    status: json["status"] == null ? undefined : SqlV1ConnectionStatusFromJSON(json["status"]),
  };
}

export function GetSqlv1Connection200ResponseToJSON(json: any): GetSqlv1Connection200Response {
  return GetSqlv1Connection200ResponseToJSONTyped(json, false);
}

export function GetSqlv1Connection200ResponseToJSONTyped(
  value?: Omit<GetSqlv1Connection200Response, "api_version" | "kind"> | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    metadata: SqlV1ConnectionMetadataToJSON(value["metadata"]),
    name: value["name"],
    spec: value["spec"],
    status: SqlV1ConnectionStatusToJSON(value["status"]),
  };
}
