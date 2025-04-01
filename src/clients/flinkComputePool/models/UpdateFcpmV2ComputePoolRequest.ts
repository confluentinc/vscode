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
import type { UpdateFcpmV2ComputePoolRequestAllOfSpec } from "./UpdateFcpmV2ComputePoolRequestAllOfSpec";
import {
  UpdateFcpmV2ComputePoolRequestAllOfSpecFromJSON,
  UpdateFcpmV2ComputePoolRequestAllOfSpecFromJSONTyped,
  UpdateFcpmV2ComputePoolRequestAllOfSpecToJSON,
  UpdateFcpmV2ComputePoolRequestAllOfSpecToJSONTyped,
} from "./UpdateFcpmV2ComputePoolRequestAllOfSpec";
import type { FcpmV2ComputePoolMetadata } from "./FcpmV2ComputePoolMetadata";
import {
  FcpmV2ComputePoolMetadataFromJSON,
  FcpmV2ComputePoolMetadataFromJSONTyped,
  FcpmV2ComputePoolMetadataToJSON,
  FcpmV2ComputePoolMetadataToJSONTyped,
} from "./FcpmV2ComputePoolMetadata";

/**
 *
 * @export
 * @interface UpdateFcpmV2ComputePoolRequest
 */
export interface UpdateFcpmV2ComputePoolRequest {
  /**
   * APIVersion defines the schema version of this representation of a resource.
   * @type {string}
   * @memberof UpdateFcpmV2ComputePoolRequest
   */
  readonly api_version?: UpdateFcpmV2ComputePoolRequestApiVersionEnum;
  /**
   * Kind defines the object this REST resource represents.
   * @type {string}
   * @memberof UpdateFcpmV2ComputePoolRequest
   */
  readonly kind?: UpdateFcpmV2ComputePoolRequestKindEnum;
  /**
   * ID is the "natural identifier" for an object within its scope/namespace; it is normally unique across time but not space. That is, you can assume that the ID will not be reclaimed and reused after an object is deleted ("time"); however, it may collide with IDs for other object `kinds` or objects of the same `kind` within a different scope/namespace ("space").
   * @type {string}
   * @memberof UpdateFcpmV2ComputePoolRequest
   */
  readonly id?: string;
  /**
   *
   * @type {FcpmV2ComputePoolMetadata}
   * @memberof UpdateFcpmV2ComputePoolRequest
   */
  metadata?: FcpmV2ComputePoolMetadata;
  /**
   *
   * @type {UpdateFcpmV2ComputePoolRequestAllOfSpec}
   * @memberof UpdateFcpmV2ComputePoolRequest
   */
  spec: UpdateFcpmV2ComputePoolRequestAllOfSpec;
  /**
   *
   * @type {FcpmV2ComputePoolStatus}
   * @memberof UpdateFcpmV2ComputePoolRequest
   */
  status?: FcpmV2ComputePoolStatus;
}

/**
 * @export
 */
export const UpdateFcpmV2ComputePoolRequestApiVersionEnum = {
  FcpmV2: "fcpm/v2",
} as const;
export type UpdateFcpmV2ComputePoolRequestApiVersionEnum =
  (typeof UpdateFcpmV2ComputePoolRequestApiVersionEnum)[keyof typeof UpdateFcpmV2ComputePoolRequestApiVersionEnum];

/**
 * @export
 */
export const UpdateFcpmV2ComputePoolRequestKindEnum = {
  ComputePool: "ComputePool",
} as const;
export type UpdateFcpmV2ComputePoolRequestKindEnum =
  (typeof UpdateFcpmV2ComputePoolRequestKindEnum)[keyof typeof UpdateFcpmV2ComputePoolRequestKindEnum];

/**
 * Check if a given object implements the UpdateFcpmV2ComputePoolRequest interface.
 */
export function instanceOfUpdateFcpmV2ComputePoolRequest(
  value: object,
): value is UpdateFcpmV2ComputePoolRequest {
  if (!("spec" in value) || value["spec"] === undefined) return false;
  return true;
}

export function UpdateFcpmV2ComputePoolRequestFromJSON(json: any): UpdateFcpmV2ComputePoolRequest {
  return UpdateFcpmV2ComputePoolRequestFromJSONTyped(json, false);
}

export function UpdateFcpmV2ComputePoolRequestFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): UpdateFcpmV2ComputePoolRequest {
  if (json == null) {
    return json;
  }
  return {
    api_version: json["api_version"] == null ? undefined : json["api_version"],
    kind: json["kind"] == null ? undefined : json["kind"],
    id: json["id"] == null ? undefined : json["id"],
    metadata:
      json["metadata"] == null ? undefined : FcpmV2ComputePoolMetadataFromJSON(json["metadata"]),
    spec: UpdateFcpmV2ComputePoolRequestAllOfSpecFromJSON(json["spec"]),
    status: json["status"] == null ? undefined : FcpmV2ComputePoolStatusFromJSON(json["status"]),
  };
}

export function UpdateFcpmV2ComputePoolRequestToJSON(json: any): UpdateFcpmV2ComputePoolRequest {
  return UpdateFcpmV2ComputePoolRequestToJSONTyped(json, false);
}

export function UpdateFcpmV2ComputePoolRequestToJSONTyped(
  value?: Omit<UpdateFcpmV2ComputePoolRequest, "api_version" | "kind" | "id"> | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    metadata: FcpmV2ComputePoolMetadataToJSON(value["metadata"]),
    spec: UpdateFcpmV2ComputePoolRequestAllOfSpecToJSON(value["spec"]),
    status: FcpmV2ComputePoolStatusToJSON(value["status"]),
  };
}
