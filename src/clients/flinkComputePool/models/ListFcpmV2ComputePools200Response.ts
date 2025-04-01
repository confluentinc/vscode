/* tslint:disable */
/* eslint-disable */
/**
 * Flink Compute Pool Management API
 * This is the Flink Compute Pool management API.
 *
 * The version of the OpenAPI document: 0.0.1
 * Contact: ksql-team@confluent.io
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */

import { mapValues } from "../runtime";
import type { FcpmV2ComputePoolListMetadata } from "./FcpmV2ComputePoolListMetadata";
import {
  FcpmV2ComputePoolListMetadataFromJSON,
  FcpmV2ComputePoolListMetadataFromJSONTyped,
  FcpmV2ComputePoolListMetadataToJSON,
  FcpmV2ComputePoolListMetadataToJSONTyped,
} from "./FcpmV2ComputePoolListMetadata";
import type { ListFcpmV2ComputePools200ResponseAllOfDataInner } from "./ListFcpmV2ComputePools200ResponseAllOfDataInner";
import {
  ListFcpmV2ComputePools200ResponseAllOfDataInnerFromJSON,
  ListFcpmV2ComputePools200ResponseAllOfDataInnerFromJSONTyped,
  ListFcpmV2ComputePools200ResponseAllOfDataInnerToJSON,
  ListFcpmV2ComputePools200ResponseAllOfDataInnerToJSONTyped,
} from "./ListFcpmV2ComputePools200ResponseAllOfDataInner";

/**
 *
 * @export
 * @interface ListFcpmV2ComputePools200Response
 */
export interface ListFcpmV2ComputePools200Response {
  /**
   * APIVersion defines the schema version of this representation of a resource.
   * @type {string}
   * @memberof ListFcpmV2ComputePools200Response
   */
  readonly api_version: ListFcpmV2ComputePools200ResponseApiVersionEnum;
  /**
   * Kind defines the object this REST resource represents.
   * @type {string}
   * @memberof ListFcpmV2ComputePools200Response
   */
  readonly kind: ListFcpmV2ComputePools200ResponseKindEnum;
  /**
   *
   * @type {FcpmV2ComputePoolListMetadata}
   * @memberof ListFcpmV2ComputePools200Response
   */
  metadata: FcpmV2ComputePoolListMetadata;
  /**
   *
   * @type {Array<ListFcpmV2ComputePools200ResponseAllOfDataInner>}
   * @memberof ListFcpmV2ComputePools200Response
   */
  data: Array<ListFcpmV2ComputePools200ResponseAllOfDataInner>;
}

/**
 * @export
 */
export const ListFcpmV2ComputePools200ResponseApiVersionEnum = {
  FcpmV2: "fcpm/v2",
} as const;
export type ListFcpmV2ComputePools200ResponseApiVersionEnum =
  (typeof ListFcpmV2ComputePools200ResponseApiVersionEnum)[keyof typeof ListFcpmV2ComputePools200ResponseApiVersionEnum];

/**
 * @export
 */
export const ListFcpmV2ComputePools200ResponseKindEnum = {
  ComputePoolList: "ComputePoolList",
} as const;
export type ListFcpmV2ComputePools200ResponseKindEnum =
  (typeof ListFcpmV2ComputePools200ResponseKindEnum)[keyof typeof ListFcpmV2ComputePools200ResponseKindEnum];

/**
 * Check if a given object implements the ListFcpmV2ComputePools200Response interface.
 */
export function instanceOfListFcpmV2ComputePools200Response(
  value: object,
): value is ListFcpmV2ComputePools200Response {
  if (!("api_version" in value) || value["api_version"] === undefined) return false;
  if (!("kind" in value) || value["kind"] === undefined) return false;
  if (!("metadata" in value) || value["metadata"] === undefined) return false;
  if (!("data" in value) || value["data"] === undefined) return false;
  return true;
}

export function ListFcpmV2ComputePools200ResponseFromJSON(
  json: any,
): ListFcpmV2ComputePools200Response {
  return ListFcpmV2ComputePools200ResponseFromJSONTyped(json, false);
}

export function ListFcpmV2ComputePools200ResponseFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): ListFcpmV2ComputePools200Response {
  if (json == null) {
    return json;
  }
  return {
    api_version: json["api_version"],
    kind: json["kind"],
    metadata: FcpmV2ComputePoolListMetadataFromJSON(json["metadata"]),
    data: (json["data"] as Array<any>).map(ListFcpmV2ComputePools200ResponseAllOfDataInnerFromJSON),
  };
}

export function ListFcpmV2ComputePools200ResponseToJSON(
  json: any,
): ListFcpmV2ComputePools200Response {
  return ListFcpmV2ComputePools200ResponseToJSONTyped(json, false);
}

export function ListFcpmV2ComputePools200ResponseToJSONTyped(
  value?: Omit<ListFcpmV2ComputePools200Response, "api_version" | "kind"> | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    metadata: FcpmV2ComputePoolListMetadataToJSON(value["metadata"]),
    data: (value["data"] as Array<any>).map(ListFcpmV2ComputePools200ResponseAllOfDataInnerToJSON),
  };
}
