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
import type { ScaffoldV1TemplateMetadata } from "./ScaffoldV1TemplateMetadata";
import {
  ScaffoldV1TemplateMetadataFromJSON,
  ScaffoldV1TemplateMetadataFromJSONTyped,
  ScaffoldV1TemplateMetadataToJSON,
  ScaffoldV1TemplateMetadataToJSONTyped,
} from "./ScaffoldV1TemplateMetadata";

/**
 *
 * @export
 * @interface ScaffoldV1TemplateListDataInner
 */
export interface ScaffoldV1TemplateListDataInner {
  /**
   * APIVersion defines the schema version of this representation of a resource.
   * @type {string}
   * @memberof ScaffoldV1TemplateListDataInner
   */
  readonly api_version?: ScaffoldV1TemplateListDataInnerApiVersionEnum;
  /**
   * Kind defines the object this REST resource represents.
   * @type {string}
   * @memberof ScaffoldV1TemplateListDataInner
   */
  readonly kind?: ScaffoldV1TemplateListDataInnerKindEnum;
  /**
   *
   * @type {ScaffoldV1TemplateMetadata}
   * @memberof ScaffoldV1TemplateListDataInner
   */
  metadata: ScaffoldV1TemplateMetadata;
  /**
   *
   * @type {object}
   * @memberof ScaffoldV1TemplateListDataInner
   */
  spec: object;
}

/**
 * @export
 * @enum {string}
 */
export enum ScaffoldV1TemplateListDataInnerApiVersionEnum {
  ScaffoldV1 = "scaffold/v1",
}
/**
 * @export
 * @enum {string}
 */
export enum ScaffoldV1TemplateListDataInnerKindEnum {
  Template = "Template",
}

/**
 * Check if a given object implements the ScaffoldV1TemplateListDataInner interface.
 */
export function instanceOfScaffoldV1TemplateListDataInner(
  value: object,
): value is ScaffoldV1TemplateListDataInner {
  if (!("metadata" in value) || value["metadata"] === undefined) return false;
  if (!("spec" in value) || value["spec"] === undefined) return false;
  return true;
}

export function ScaffoldV1TemplateListDataInnerFromJSON(
  json: any,
): ScaffoldV1TemplateListDataInner {
  return ScaffoldV1TemplateListDataInnerFromJSONTyped(json, false);
}

export function ScaffoldV1TemplateListDataInnerFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): ScaffoldV1TemplateListDataInner {
  if (json == null) {
    return json;
  }
  return {
    api_version: json["api_version"] == null ? undefined : json["api_version"],
    kind: json["kind"] == null ? undefined : json["kind"],
    metadata: ScaffoldV1TemplateMetadataFromJSON(json["metadata"]),
    spec: json["spec"],
  };
}

export function ScaffoldV1TemplateListDataInnerToJSON(json: any): ScaffoldV1TemplateListDataInner {
  return ScaffoldV1TemplateListDataInnerToJSONTyped(json, false);
}

export function ScaffoldV1TemplateListDataInnerToJSONTyped(
  value?: Omit<ScaffoldV1TemplateListDataInner, "api_version" | "kind"> | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    metadata: ScaffoldV1TemplateMetadataToJSON(value["metadata"]),
    spec: value["spec"],
  };
}
