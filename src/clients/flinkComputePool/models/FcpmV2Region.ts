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
import type { FcpmV2RegionMetadata } from "./FcpmV2RegionMetadata";
import {
  FcpmV2RegionMetadataFromJSON,
  FcpmV2RegionMetadataFromJSONTyped,
  FcpmV2RegionMetadataToJSON,
  FcpmV2RegionMetadataToJSONTyped,
} from "./FcpmV2RegionMetadata";

/**
 * `Region` objects represent cloud provider regions available when placing Flink compute pools.
 * The API allows you to list Flink regions.
 *
 *
 * ## The Regions Model
 * <SchemaDefinition schemaRef="#/components/schemas/fcpm.v2.Region" />
 * @export
 * @interface FcpmV2Region
 */
export interface FcpmV2Region {
  /**
   * APIVersion defines the schema version of this representation of a resource.
   * @type {string}
   * @memberof FcpmV2Region
   */
  readonly api_version?: FcpmV2RegionApiVersionEnum;
  /**
   * Kind defines the object this REST resource represents.
   * @type {string}
   * @memberof FcpmV2Region
   */
  readonly kind?: FcpmV2RegionKindEnum;
  /**
   * ID is the "natural identifier" for an object within its scope/namespace; it is normally unique across time but not space. That is, you can assume that the ID will not be reclaimed and reused after an object is deleted ("time"); however, it may collide with IDs for other object `kinds` or objects of the same `kind` within a different scope/namespace ("space").
   * @type {string}
   * @memberof FcpmV2Region
   */
  readonly id?: string;
  /**
   *
   * @type {FcpmV2RegionMetadata}
   * @memberof FcpmV2Region
   */
  metadata?: FcpmV2RegionMetadata;
  /**
   * The display name.
   * @type {string}
   * @memberof FcpmV2Region
   */
  readonly display_name?: string;
  /**
   * The cloud service provider that hosts the region.
   * @type {string}
   * @memberof FcpmV2Region
   */
  readonly cloud?: string;
  /**
   * The region name.
   * @type {string}
   * @memberof FcpmV2Region
   */
  readonly region_name?: string;
  /**
   * The regional API endpoint for Flink compute pools.
   * @type {string}
   * @memberof FcpmV2Region
   */
  readonly http_endpoint?: string;
  /**
   * The private regional API endpoint for Flink compute pools.
   * @type {string}
   * @memberof FcpmV2Region
   */
  readonly private_http_endpoint?: string;
}

/**
 * @export
 */
export const FcpmV2RegionApiVersionEnum = {
  FcpmV2: "fcpm/v2",
} as const;
export type FcpmV2RegionApiVersionEnum =
  (typeof FcpmV2RegionApiVersionEnum)[keyof typeof FcpmV2RegionApiVersionEnum];

/**
 * @export
 */
export const FcpmV2RegionKindEnum = {
  Region: "Region",
} as const;
export type FcpmV2RegionKindEnum = (typeof FcpmV2RegionKindEnum)[keyof typeof FcpmV2RegionKindEnum];

/**
 * Check if a given object implements the FcpmV2Region interface.
 */
export function instanceOfFcpmV2Region(value: object): value is FcpmV2Region {
  return true;
}

export function FcpmV2RegionFromJSON(json: any): FcpmV2Region {
  return FcpmV2RegionFromJSONTyped(json, false);
}

export function FcpmV2RegionFromJSONTyped(json: any, ignoreDiscriminator: boolean): FcpmV2Region {
  if (json == null) {
    return json;
  }
  return {
    api_version: json["api_version"] == null ? undefined : json["api_version"],
    kind: json["kind"] == null ? undefined : json["kind"],
    id: json["id"] == null ? undefined : json["id"],
    metadata: json["metadata"] == null ? undefined : FcpmV2RegionMetadataFromJSON(json["metadata"]),
    display_name: json["display_name"] == null ? undefined : json["display_name"],
    cloud: json["cloud"] == null ? undefined : json["cloud"],
    region_name: json["region_name"] == null ? undefined : json["region_name"],
    http_endpoint: json["http_endpoint"] == null ? undefined : json["http_endpoint"],
    private_http_endpoint:
      json["private_http_endpoint"] == null ? undefined : json["private_http_endpoint"],
  };
}

export function FcpmV2RegionToJSON(json: any): FcpmV2Region {
  return FcpmV2RegionToJSONTyped(json, false);
}

export function FcpmV2RegionToJSONTyped(
  value?: Omit<
    FcpmV2Region,
    | "api_version"
    | "kind"
    | "id"
    | "display_name"
    | "cloud"
    | "region_name"
    | "http_endpoint"
    | "private_http_endpoint"
  > | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    metadata: FcpmV2RegionMetadataToJSON(value["metadata"]),
  };
}
