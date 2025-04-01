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
import type { ArtifactV1FlinkArtifactVersion } from "./ArtifactV1FlinkArtifactVersion";
import {
  ArtifactV1FlinkArtifactVersionFromJSON,
  ArtifactV1FlinkArtifactVersionFromJSONTyped,
  ArtifactV1FlinkArtifactVersionToJSON,
  ArtifactV1FlinkArtifactVersionToJSONTyped,
} from "./ArtifactV1FlinkArtifactVersion";
import type { ArtifactV1FlinkArtifactMetadata } from "./ArtifactV1FlinkArtifactMetadata";
import {
  ArtifactV1FlinkArtifactMetadataFromJSON,
  ArtifactV1FlinkArtifactMetadataFromJSONTyped,
  ArtifactV1FlinkArtifactMetadataToJSON,
  ArtifactV1FlinkArtifactMetadataToJSONTyped,
} from "./ArtifactV1FlinkArtifactMetadata";

/**
 * FlinkArtifact objects represent Flink Artifacts on Confluent Cloud.
 *
 *
 * ## The Flink Artifacts Model
 * <SchemaDefinition schemaRef="#/components/schemas/artifact.v1.FlinkArtifact" />
 * @export
 * @interface ArtifactV1FlinkArtifact
 */
export interface ArtifactV1FlinkArtifact {
  /**
   * APIVersion defines the schema version of this representation of a resource.
   * @type {string}
   * @memberof ArtifactV1FlinkArtifact
   */
  readonly api_version?: ArtifactV1FlinkArtifactApiVersionEnum;
  /**
   * Kind defines the object this REST resource represents.
   * @type {string}
   * @memberof ArtifactV1FlinkArtifact
   */
  readonly kind?: ArtifactV1FlinkArtifactKindEnum;
  /**
   * ID is the "natural identifier" for an object within its scope/namespace; it is normally unique across time but not space. That is, you can assume that the ID will not be reclaimed and reused after an object is deleted ("time"); however, it may collide with IDs for other object `kinds` or objects of the same `kind` within a different scope/namespace ("space").
   * @type {string}
   * @memberof ArtifactV1FlinkArtifact
   */
  readonly id?: string;
  /**
   *
   * @type {ArtifactV1FlinkArtifactMetadata}
   * @memberof ArtifactV1FlinkArtifact
   */
  metadata?: ArtifactV1FlinkArtifactMetadata;
  /**
   * Cloud provider where the Flink Artifact archive is uploaded.
   * @type {string}
   * @memberof ArtifactV1FlinkArtifact
   */
  cloud?: string;
  /**
   * The Cloud provider region the Flink Artifact archive is uploaded.
   * @type {string}
   * @memberof ArtifactV1FlinkArtifact
   */
  region?: string;
  /**
   * Environment the Flink Artifact belongs to.
   * @type {string}
   * @memberof ArtifactV1FlinkArtifact
   */
  environment?: string;
  /**
   * Unique name of the Flink Artifact per cloud, region, environment scope.
   * @type {string}
   * @memberof ArtifactV1FlinkArtifact
   */
  display_name?: string;
  /**
   * Java class or alias for the artifact as provided by developer. Deprecated
   * @type {string}
   * @memberof ArtifactV1FlinkArtifact
   * @deprecated
   */
  _class?: string;
  /**
   * Archive format of the Flink Artifact.
   * @type {string}
   * @memberof ArtifactV1FlinkArtifact
   */
  content_format?: string;
  /**
   * Description of the Flink Artifact.
   * @type {string}
   * @memberof ArtifactV1FlinkArtifact
   */
  description?: string;
  /**
   * Documentation link of the Flink Artifact.
   * @type {string}
   * @memberof ArtifactV1FlinkArtifact
   */
  documentation_link?: string;
  /**
   * Runtime language of the Flink Artifact.
   * @type {string}
   * @memberof ArtifactV1FlinkArtifact
   */
  runtime_language?: string;
  /**
   * Versions associated with this Flink Artifact.
   * @type {Array<ArtifactV1FlinkArtifactVersion>}
   * @memberof ArtifactV1FlinkArtifact
   */
  versions?: Array<ArtifactV1FlinkArtifactVersion>;
}

/**
 * @export
 * @enum {string}
 */
export enum ArtifactV1FlinkArtifactApiVersionEnum {
  ArtifactV1 = "artifact/v1",
}
/**
 * @export
 * @enum {string}
 */
export enum ArtifactV1FlinkArtifactKindEnum {
  FlinkArtifact = "FlinkArtifact",
}

/**
 * Check if a given object implements the ArtifactV1FlinkArtifact interface.
 */
export function instanceOfArtifactV1FlinkArtifact(value: object): value is ArtifactV1FlinkArtifact {
  return true;
}

export function ArtifactV1FlinkArtifactFromJSON(json: any): ArtifactV1FlinkArtifact {
  return ArtifactV1FlinkArtifactFromJSONTyped(json, false);
}

export function ArtifactV1FlinkArtifactFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): ArtifactV1FlinkArtifact {
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
        : ArtifactV1FlinkArtifactMetadataFromJSON(json["metadata"]),
    cloud: json["cloud"] == null ? undefined : json["cloud"],
    region: json["region"] == null ? undefined : json["region"],
    environment: json["environment"] == null ? undefined : json["environment"],
    display_name: json["display_name"] == null ? undefined : json["display_name"],
    _class: json["class"] == null ? undefined : json["class"],
    content_format: json["content_format"] == null ? undefined : json["content_format"],
    description: json["description"] == null ? undefined : json["description"],
    documentation_link: json["documentation_link"] == null ? undefined : json["documentation_link"],
    runtime_language: json["runtime_language"] == null ? undefined : json["runtime_language"],
    versions:
      json["versions"] == null
        ? undefined
        : (json["versions"] as Array<any>).map(ArtifactV1FlinkArtifactVersionFromJSON),
  };
}

export function ArtifactV1FlinkArtifactToJSON(json: any): ArtifactV1FlinkArtifact {
  return ArtifactV1FlinkArtifactToJSONTyped(json, false);
}

export function ArtifactV1FlinkArtifactToJSONTyped(
  value?: Omit<ArtifactV1FlinkArtifact, "api_version" | "kind" | "id"> | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    metadata: ArtifactV1FlinkArtifactMetadataToJSON(value["metadata"]),
    cloud: value["cloud"],
    region: value["region"],
    environment: value["environment"],
    display_name: value["display_name"],
    class: value["_class"],
    content_format: value["content_format"],
    description: value["description"],
    documentation_link: value["documentation_link"],
    runtime_language: value["runtime_language"],
    versions:
      value["versions"] == null
        ? undefined
        : (value["versions"] as Array<any>).map(ArtifactV1FlinkArtifactVersionToJSON),
  };
}
