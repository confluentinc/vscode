/* tslint:disable */
/* eslint-disable */
/**
 * Scaffolding API
 * The Scaffolding Service exposes collections of templates that can be applied to generate application projects.
 *
 * The version of the OpenAPI document: 0.0.1
 *
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */

import { mapValues } from "../runtime";
import type { ScaffoldV1TemplateCollectionMetadata } from "./ScaffoldV1TemplateCollectionMetadata";
import {
  ScaffoldV1TemplateCollectionMetadataFromJSON,
  ScaffoldV1TemplateCollectionMetadataFromJSONTyped,
  ScaffoldV1TemplateCollectionMetadataToJSON,
  ScaffoldV1TemplateCollectionMetadataToJSONTyped,
} from "./ScaffoldV1TemplateCollectionMetadata";

/**
 *
 * @export
 * @interface ScaffoldV1TemplateCollectionListDataInner
 */
export interface ScaffoldV1TemplateCollectionListDataInner {
  /**
   * APIVersion defines the schema version of this representation of a resource.
   * @type {string}
   * @memberof ScaffoldV1TemplateCollectionListDataInner
   */
  readonly api_version?: ScaffoldV1TemplateCollectionListDataInnerApiVersionEnum;
  /**
   * Kind defines the object this REST resource represents.
   * @type {string}
   * @memberof ScaffoldV1TemplateCollectionListDataInner
   */
  readonly kind?: ScaffoldV1TemplateCollectionListDataInnerKindEnum;
  /**
   *
   * @type {ScaffoldV1TemplateCollectionMetadata}
   * @memberof ScaffoldV1TemplateCollectionListDataInner
   */
  metadata: ScaffoldV1TemplateCollectionMetadata;
  /**
   *
   * @type {object}
   * @memberof ScaffoldV1TemplateCollectionListDataInner
   */
  spec: object;
}

/**
 * @export
 * @enum {string}
 */
export enum ScaffoldV1TemplateCollectionListDataInnerApiVersionEnum {
  ScaffoldV1 = "scaffold/v1",
}
/**
 * @export
 * @enum {string}
 */
export enum ScaffoldV1TemplateCollectionListDataInnerKindEnum {
  TemplateCollection = "TemplateCollection",
}

/**
 * Check if a given object implements the ScaffoldV1TemplateCollectionListDataInner interface.
 */
export function instanceOfScaffoldV1TemplateCollectionListDataInner(
  value: object,
): value is ScaffoldV1TemplateCollectionListDataInner {
  if (!("metadata" in value) || value["metadata"] === undefined) return false;
  if (!("spec" in value) || value["spec"] === undefined) return false;
  return true;
}

export function ScaffoldV1TemplateCollectionListDataInnerFromJSON(
  json: any,
): ScaffoldV1TemplateCollectionListDataInner {
  return ScaffoldV1TemplateCollectionListDataInnerFromJSONTyped(json, false);
}

export function ScaffoldV1TemplateCollectionListDataInnerFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): ScaffoldV1TemplateCollectionListDataInner {
  if (json == null) {
    return json;
  }
  return {
    api_version: json["api_version"] == null ? undefined : json["api_version"],
    kind: json["kind"] == null ? undefined : json["kind"],
    metadata: ScaffoldV1TemplateCollectionMetadataFromJSON(json["metadata"]),
    spec: json["spec"],
  };
}

export function ScaffoldV1TemplateCollectionListDataInnerToJSON(
  json: any,
): ScaffoldV1TemplateCollectionListDataInner {
  return ScaffoldV1TemplateCollectionListDataInnerToJSONTyped(json, false);
}

export function ScaffoldV1TemplateCollectionListDataInnerToJSONTyped(
  value?: Omit<ScaffoldV1TemplateCollectionListDataInner, "api_version" | "kind"> | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    metadata: ScaffoldV1TemplateCollectionMetadataToJSON(value["metadata"]),
    spec: value["spec"],
  };
}
