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
import type { ArtifactV1FlinkArtifactListMetadata } from "./ArtifactV1FlinkArtifactListMetadata";
import {
  ArtifactV1FlinkArtifactListMetadataFromJSON,
  ArtifactV1FlinkArtifactListMetadataFromJSONTyped,
  ArtifactV1FlinkArtifactListMetadataToJSON,
  ArtifactV1FlinkArtifactListMetadataToJSONTyped,
} from "./ArtifactV1FlinkArtifactListMetadata";
import type { ArtifactV1FlinkArtifactListDataInner } from "./ArtifactV1FlinkArtifactListDataInner";
import {
  ArtifactV1FlinkArtifactListDataInnerFromJSON,
  ArtifactV1FlinkArtifactListDataInnerFromJSONTyped,
  ArtifactV1FlinkArtifactListDataInnerToJSON,
  ArtifactV1FlinkArtifactListDataInnerToJSONTyped,
} from "./ArtifactV1FlinkArtifactListDataInner";

/**
 * FlinkArtifact objects represent Flink Artifacts on Confluent Cloud.
 *
 *
 * ## The Flink Artifacts Model
 * <SchemaDefinition schemaRef="#/components/schemas/artifact.v1.FlinkArtifact" />
 * @export
 * @interface ArtifactV1FlinkArtifactList
 */
export interface ArtifactV1FlinkArtifactList {
  /**
   * APIVersion defines the schema version of this representation of a resource.
   * @type {string}
   * @memberof ArtifactV1FlinkArtifactList
   */
  readonly api_version: ArtifactV1FlinkArtifactListApiVersionEnum;
  /**
   * Kind defines the object this REST resource represents.
   * @type {string}
   * @memberof ArtifactV1FlinkArtifactList
   */
  readonly kind: ArtifactV1FlinkArtifactListKindEnum;
  /**
   *
   * @type {ArtifactV1FlinkArtifactListMetadata}
   * @memberof ArtifactV1FlinkArtifactList
   */
  metadata: ArtifactV1FlinkArtifactListMetadata;
  /**
   * A data property that contains an array of resource items. Each entry in the array is a separate resource.
   * @type {Set<ArtifactV1FlinkArtifactListDataInner>}
   * @memberof ArtifactV1FlinkArtifactList
   */
  data: Set<ArtifactV1FlinkArtifactListDataInner>;
}

/**
 * @export
 * @enum {string}
 */
export enum ArtifactV1FlinkArtifactListApiVersionEnum {
  ArtifactV1 = "artifact/v1",
}
/**
 * @export
 * @enum {string}
 */
export enum ArtifactV1FlinkArtifactListKindEnum {
  FlinkArtifactList = "FlinkArtifactList",
}

/**
 * Check if a given object implements the ArtifactV1FlinkArtifactList interface.
 */
export function instanceOfArtifactV1FlinkArtifactList(
  value: object,
): value is ArtifactV1FlinkArtifactList {
  if (!("api_version" in value) || value["api_version"] === undefined) return false;
  if (!("kind" in value) || value["kind"] === undefined) return false;
  if (!("metadata" in value) || value["metadata"] === undefined) return false;
  if (!("data" in value) || value["data"] === undefined) return false;
  return true;
}

export function ArtifactV1FlinkArtifactListFromJSON(json: any): ArtifactV1FlinkArtifactList {
  return ArtifactV1FlinkArtifactListFromJSONTyped(json, false);
}

export function ArtifactV1FlinkArtifactListFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): ArtifactV1FlinkArtifactList {
  if (json == null) {
    return json;
  }
  return {
    api_version: json["api_version"],
    kind: json["kind"],
    metadata: ArtifactV1FlinkArtifactListMetadataFromJSON(json["metadata"]),
    data: new Set((json["data"] as Array<any>).map(ArtifactV1FlinkArtifactListDataInnerFromJSON)),
  };
}

export function ArtifactV1FlinkArtifactListToJSON(json: any): ArtifactV1FlinkArtifactList {
  return ArtifactV1FlinkArtifactListToJSONTyped(json, false);
}

export function ArtifactV1FlinkArtifactListToJSONTyped(
  value?: Omit<ArtifactV1FlinkArtifactList, "api_version" | "kind"> | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    metadata: ArtifactV1FlinkArtifactListMetadataToJSON(value["metadata"]),
    data: Array.from(value["data"] as Set<any>).map(ArtifactV1FlinkArtifactListDataInnerToJSON),
  };
}
