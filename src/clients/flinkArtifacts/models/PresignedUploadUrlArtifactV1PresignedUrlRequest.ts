/* tslint:disable */
/* eslint-disable */
/**
 * Flink Artifact Management API
 * This is the Flink Artifact Management API.
 *
 * The version of the OpenAPI document: 0.0.1
 *
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */

import { mapValues } from "../runtime";
import type { ArtifactV1PresignedUrlRequestMetadata } from "./ArtifactV1PresignedUrlRequestMetadata";
import {
  ArtifactV1PresignedUrlRequestMetadataFromJSON,
  ArtifactV1PresignedUrlRequestMetadataFromJSONTyped,
  ArtifactV1PresignedUrlRequestMetadataToJSON,
  ArtifactV1PresignedUrlRequestMetadataToJSONTyped,
} from "./ArtifactV1PresignedUrlRequestMetadata";

/**
 *
 * @export
 * @interface PresignedUploadUrlArtifactV1PresignedUrlRequest
 */
export interface PresignedUploadUrlArtifactV1PresignedUrlRequest {
  /**
   * APIVersion defines the schema version of this representation of a resource.
   * @type {string}
   * @memberof PresignedUploadUrlArtifactV1PresignedUrlRequest
   */
  readonly api_version?: PresignedUploadUrlArtifactV1PresignedUrlRequestApiVersionEnum;
  /**
   * Kind defines the object this REST resource represents.
   * @type {string}
   * @memberof PresignedUploadUrlArtifactV1PresignedUrlRequest
   */
  readonly kind?: PresignedUploadUrlArtifactV1PresignedUrlRequestKindEnum;
  /**
   * ID is the "natural identifier" for an object within its scope/namespace; it is normally unique across time but not space. That is, you can assume that the ID will not be reclaimed and reused after an object is deleted ("time"); however, it may collide with IDs for other object `kinds` or objects of the same `kind` within a different scope/namespace ("space").
   * @type {string}
   * @memberof PresignedUploadUrlArtifactV1PresignedUrlRequest
   */
  readonly id?: string;
  /**
   *
   * @type {ArtifactV1PresignedUrlRequestMetadata}
   * @memberof PresignedUploadUrlArtifactV1PresignedUrlRequest
   */
  metadata?: ArtifactV1PresignedUrlRequestMetadata;
  /**
   * Archive format of the Flink Artifact.
   * @type {string}
   * @memberof PresignedUploadUrlArtifactV1PresignedUrlRequest
   */
  content_format: string;
  /**
   * Cloud provider where the Flink Artifact archive is uploaded.
   * @type {string}
   * @memberof PresignedUploadUrlArtifactV1PresignedUrlRequest
   */
  cloud: string;
  /**
   * The Cloud provider region the Flink Artifact archive is uploaded.
   * @type {string}
   * @memberof PresignedUploadUrlArtifactV1PresignedUrlRequest
   */
  region: string;
  /**
   * The Environment the uploaded Flink Artifact belongs to.
   * @type {string}
   * @memberof PresignedUploadUrlArtifactV1PresignedUrlRequest
   */
  environment: string;
}

/**
 * @export
 */
export const PresignedUploadUrlArtifactV1PresignedUrlRequestApiVersionEnum = {
  ArtifactV1: "artifact/v1",
} as const;
export type PresignedUploadUrlArtifactV1PresignedUrlRequestApiVersionEnum =
  (typeof PresignedUploadUrlArtifactV1PresignedUrlRequestApiVersionEnum)[keyof typeof PresignedUploadUrlArtifactV1PresignedUrlRequestApiVersionEnum];

/**
 * @export
 */
export const PresignedUploadUrlArtifactV1PresignedUrlRequestKindEnum = {
  PresignedUrlRequest: "PresignedUrlRequest",
} as const;
export type PresignedUploadUrlArtifactV1PresignedUrlRequestKindEnum =
  (typeof PresignedUploadUrlArtifactV1PresignedUrlRequestKindEnum)[keyof typeof PresignedUploadUrlArtifactV1PresignedUrlRequestKindEnum];

/**
 * Check if a given object implements the PresignedUploadUrlArtifactV1PresignedUrlRequest interface.
 */
export function instanceOfPresignedUploadUrlArtifactV1PresignedUrlRequest(
  value: object,
): value is PresignedUploadUrlArtifactV1PresignedUrlRequest {
  if (!("content_format" in value) || value["content_format"] === undefined) return false;
  if (!("cloud" in value) || value["cloud"] === undefined) return false;
  if (!("region" in value) || value["region"] === undefined) return false;
  if (!("environment" in value) || value["environment"] === undefined) return false;
  return true;
}

export function PresignedUploadUrlArtifactV1PresignedUrlRequestFromJSON(
  json: any,
): PresignedUploadUrlArtifactV1PresignedUrlRequest {
  return PresignedUploadUrlArtifactV1PresignedUrlRequestFromJSONTyped(json, false);
}

export function PresignedUploadUrlArtifactV1PresignedUrlRequestFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): PresignedUploadUrlArtifactV1PresignedUrlRequest {
  if (json == null) {
    return json;
  }
  return {
    api_version: json["api_version"] == null ? undefined : json["api_version"],
    kind: json["kind"] == null ? undefined : json["kind"],
    id: json["id"] == null ? undefined : json["id"],
    metadata:
      json["metadata"] == null
        ? undefined
        : ArtifactV1PresignedUrlRequestMetadataFromJSON(json["metadata"]),
    content_format: json["content_format"],
    cloud: json["cloud"],
    region: json["region"],
    environment: json["environment"],
  };
}

export function PresignedUploadUrlArtifactV1PresignedUrlRequestToJSON(
  json: any,
): PresignedUploadUrlArtifactV1PresignedUrlRequest {
  return PresignedUploadUrlArtifactV1PresignedUrlRequestToJSONTyped(json, false);
}

export function PresignedUploadUrlArtifactV1PresignedUrlRequestToJSONTyped(
  value?: Omit<
    PresignedUploadUrlArtifactV1PresignedUrlRequest,
    "api_version" | "kind" | "id"
  > | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    metadata: ArtifactV1PresignedUrlRequestMetadataToJSON(value["metadata"]),
    content_format: value["content_format"],
    cloud: value["cloud"],
    region: value["region"],
    environment: value["environment"],
  };
}
