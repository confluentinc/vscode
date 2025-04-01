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
/**
 * Request a presigned upload URL for new Flink Artifact. Note that
 * the URL policy expires in one hour. If the policy expires, you can request
 * a new presigned upload URL.
 *
 *
 * ## The Presigned Urls Model
 * <SchemaDefinition schemaRef="#/components/schemas/artifact.v1.PresignedUrl" />
 * @export
 * @interface ArtifactV1PresignedUrl
 */
export interface ArtifactV1PresignedUrl {
  /**
   * APIVersion defines the schema version of this representation of a resource.
   * @type {string}
   * @memberof ArtifactV1PresignedUrl
   */
  readonly api_version?: ArtifactV1PresignedUrlApiVersionEnum;
  /**
   * Kind defines the object this REST resource represents.
   * @type {string}
   * @memberof ArtifactV1PresignedUrl
   */
  readonly kind?: ArtifactV1PresignedUrlKindEnum;
  /**
   * Content format of the Flink Artifact archive.
   * @type {string}
   * @memberof ArtifactV1PresignedUrl
   */
  readonly content_format?: string;
  /**
   * Cloud provider where the Flink Artifact archive is uploaded.
   * @type {string}
   * @memberof ArtifactV1PresignedUrl
   */
  readonly cloud?: string;
  /**
   * The Cloud provider region the Flink Artifact archive is uploaded.
   * @type {string}
   * @memberof ArtifactV1PresignedUrl
   */
  readonly region?: string;
  /**
   * The Environment the uploaded Flink Artifact belongs to.
   * @type {string}
   * @memberof ArtifactV1PresignedUrl
   */
  readonly environment?: string;
  /**
   * Unique identifier of this upload.
   * @type {string}
   * @memberof ArtifactV1PresignedUrl
   */
  readonly upload_id?: string;
  /**
   * Upload URL for the Flink Artifact archive.
   * @type {string}
   * @memberof ArtifactV1PresignedUrl
   */
  readonly upload_url?: string;
  /**
   * Upload form data of the Flink Artifact. All values should be strings.
   * @type {object}
   * @memberof ArtifactV1PresignedUrl
   */
  readonly upload_form_data?: object;
}

/**
 * @export
 */
export const ArtifactV1PresignedUrlApiVersionEnum = {
  ArtifactV1: "artifact/v1",
} as const;
export type ArtifactV1PresignedUrlApiVersionEnum =
  (typeof ArtifactV1PresignedUrlApiVersionEnum)[keyof typeof ArtifactV1PresignedUrlApiVersionEnum];

/**
 * @export
 */
export const ArtifactV1PresignedUrlKindEnum = {
  PresignedUrl: "PresignedUrl",
} as const;
export type ArtifactV1PresignedUrlKindEnum =
  (typeof ArtifactV1PresignedUrlKindEnum)[keyof typeof ArtifactV1PresignedUrlKindEnum];

/**
 * Check if a given object implements the ArtifactV1PresignedUrl interface.
 */
export function instanceOfArtifactV1PresignedUrl(value: object): value is ArtifactV1PresignedUrl {
  return true;
}

export function ArtifactV1PresignedUrlFromJSON(json: any): ArtifactV1PresignedUrl {
  return ArtifactV1PresignedUrlFromJSONTyped(json, false);
}

export function ArtifactV1PresignedUrlFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): ArtifactV1PresignedUrl {
  if (json == null) {
    return json;
  }
  return {
    api_version: json["api_version"] == null ? undefined : json["api_version"],
    kind: json["kind"] == null ? undefined : json["kind"],
    content_format: json["content_format"] == null ? undefined : json["content_format"],
    cloud: json["cloud"] == null ? undefined : json["cloud"],
    region: json["region"] == null ? undefined : json["region"],
    environment: json["environment"] == null ? undefined : json["environment"],
    upload_id: json["upload_id"] == null ? undefined : json["upload_id"],
    upload_url: json["upload_url"] == null ? undefined : json["upload_url"],
    upload_form_data: json["upload_form_data"] == null ? undefined : json["upload_form_data"],
  };
}

export function ArtifactV1PresignedUrlToJSON(json: any): ArtifactV1PresignedUrl {
  return ArtifactV1PresignedUrlToJSONTyped(json, false);
}

export function ArtifactV1PresignedUrlToJSONTyped(
  value?: Omit<
    ArtifactV1PresignedUrl,
    | "api_version"
    | "kind"
    | "content_format"
    | "cloud"
    | "region"
    | "environment"
    | "upload_id"
    | "upload_url"
    | "upload_form_data"
  > | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {};
}
