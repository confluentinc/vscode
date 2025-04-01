/* tslint:disable */
/* eslint-disable */
/**
 * Flink Compute Pool Management API
 * This is the Flink Compute Pool management API.
 *
 * The version of the OpenAPI document: 0.0.1
 *
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */

import { mapValues } from "../runtime";
import type { FcpmV2ComputePoolStatus } from "./FcpmV2ComputePoolStatus";
import {
  FcpmV2ComputePoolStatusFromJSON,
  FcpmV2ComputePoolStatusFromJSONTyped,
  FcpmV2ComputePoolStatusToJSON,
  FcpmV2ComputePoolStatusToJSONTyped,
} from "./FcpmV2ComputePoolStatus";
import type { FcpmV2ComputePoolSpec } from "./FcpmV2ComputePoolSpec";
import {
  FcpmV2ComputePoolSpecFromJSON,
  FcpmV2ComputePoolSpecFromJSONTyped,
  FcpmV2ComputePoolSpecToJSON,
  FcpmV2ComputePoolSpecToJSONTyped,
} from "./FcpmV2ComputePoolSpec";
import type { FcpmV2ComputePoolMetadata } from "./FcpmV2ComputePoolMetadata";
import {
  FcpmV2ComputePoolMetadataFromJSON,
  FcpmV2ComputePoolMetadataFromJSONTyped,
  FcpmV2ComputePoolMetadataToJSON,
  FcpmV2ComputePoolMetadataToJSONTyped,
} from "./FcpmV2ComputePoolMetadata";

/**
 * A Compute Pool represents a set of compute resources that is used to run your Queries.
 * The resources (CPUs, memory,…) provided by a Compute Pool are shared between all Queries that use it.
 *
 *
 * ## The Compute Pools Model
 * <SchemaDefinition schemaRef="#/components/schemas/fcpm.v2.ComputePool" />
 * @export
 * @interface FcpmV2ComputePool
 */
export interface FcpmV2ComputePool {
  /**
   * APIVersion defines the schema version of this representation of a resource.
   * @type {string}
   * @memberof FcpmV2ComputePool
   */
  readonly api_version?: FcpmV2ComputePoolApiVersionEnum;
  /**
   * Kind defines the object this REST resource represents.
   * @type {string}
   * @memberof FcpmV2ComputePool
   */
  readonly kind?: FcpmV2ComputePoolKindEnum;
  /**
   * ID is the "natural identifier" for an object within its scope/namespace; it is normally unique across time but not space. That is, you can assume that the ID will not be reclaimed and reused after an object is deleted ("time"); however, it may collide with IDs for other object `kinds` or objects of the same `kind` within a different scope/namespace ("space").
   * @type {string}
   * @memberof FcpmV2ComputePool
   */
  readonly id?: string;
  /**
   *
   * @type {FcpmV2ComputePoolMetadata}
   * @memberof FcpmV2ComputePool
   */
  metadata?: FcpmV2ComputePoolMetadata;
  /**
   *
   * @type {FcpmV2ComputePoolSpec}
   * @memberof FcpmV2ComputePool
   */
  spec?: FcpmV2ComputePoolSpec;
  /**
   *
   * @type {FcpmV2ComputePoolStatus}
   * @memberof FcpmV2ComputePool
   */
  status?: FcpmV2ComputePoolStatus;
}

/**
 * @export
 * @enum {string}
 */
export enum FcpmV2ComputePoolApiVersionEnum {
  FcpmV2 = "fcpm/v2",
}
/**
 * @export
 * @enum {string}
 */
export enum FcpmV2ComputePoolKindEnum {
  ComputePool = "ComputePool",
}

/**
 * Check if a given object implements the FcpmV2ComputePool interface.
 */
export function instanceOfFcpmV2ComputePool(value: object): value is FcpmV2ComputePool {
  return true;
}

export function FcpmV2ComputePoolFromJSON(json: any): FcpmV2ComputePool {
  return FcpmV2ComputePoolFromJSONTyped(json, false);
}

export function FcpmV2ComputePoolFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): FcpmV2ComputePool {
  if (json == null) {
    return json;
  }
  return {
    api_version: json["api_version"] == null ? undefined : json["api_version"],
    kind: json["kind"] == null ? undefined : json["kind"],
    id: json["id"] == null ? undefined : json["id"],
    metadata:
      json["metadata"] == null ? undefined : FcpmV2ComputePoolMetadataFromJSON(json["metadata"]),
    spec: json["spec"] == null ? undefined : FcpmV2ComputePoolSpecFromJSON(json["spec"]),
    status: json["status"] == null ? undefined : FcpmV2ComputePoolStatusFromJSON(json["status"]),
  };
}

export function FcpmV2ComputePoolToJSON(json: any): FcpmV2ComputePool {
  return FcpmV2ComputePoolToJSONTyped(json, false);
}

export function FcpmV2ComputePoolToJSONTyped(
  value?: Omit<FcpmV2ComputePool, "api_version" | "kind" | "id"> | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    metadata: FcpmV2ComputePoolMetadataToJSON(value["metadata"]),
    spec: FcpmV2ComputePoolSpecToJSON(value["spec"]),
    status: FcpmV2ComputePoolStatusToJSON(value["status"]),
  };
}
