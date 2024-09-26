/* tslint:disable */
/* eslint-disable */
/**
 * Confluent ide-sidecar API
 * API for the Confluent ide-sidecar, part of Confluent for VS Code
 *
 * The version of the OpenAPI document: 1.0.1
 * Contact: vscode@confluent.io
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */

import { mapValues } from "../runtime";
import type { CollectionMetadata } from "./CollectionMetadata";
import {
  CollectionMetadataFromJSON,
  CollectionMetadataFromJSONTyped,
  CollectionMetadataToJSON,
} from "./CollectionMetadata";
import type { Template } from "./Template";
import { TemplateFromJSON, TemplateFromJSONTyped, TemplateToJSON } from "./Template";

/**
 *
 * @export
 * @interface TemplateList
 */
export interface TemplateList {
  /**
   *
   * @type {string}
   * @memberof TemplateList
   */
  api_version: string;
  /**
   *
   * @type {string}
   * @memberof TemplateList
   */
  kind: string;
  /**
   *
   * @type {CollectionMetadata}
   * @memberof TemplateList
   */
  metadata: CollectionMetadata;
  /**
   *
   * @type {Array<Template>}
   * @memberof TemplateList
   */
  data: Array<Template>;
}

/**
 * Check if a given object implements the TemplateList interface.
 */
export function instanceOfTemplateList(value: object): value is TemplateList {
  if (!("api_version" in value) || value["api_version"] === undefined) return false;
  if (!("kind" in value) || value["kind"] === undefined) return false;
  if (!("metadata" in value) || value["metadata"] === undefined) return false;
  if (!("data" in value) || value["data"] === undefined) return false;
  return true;
}

export function TemplateListFromJSON(json: any): TemplateList {
  return TemplateListFromJSONTyped(json, false);
}

export function TemplateListFromJSONTyped(json: any, ignoreDiscriminator: boolean): TemplateList {
  if (json == null) {
    return json;
  }
  return {
    api_version: json["api_version"],
    kind: json["kind"],
    metadata: CollectionMetadataFromJSON(json["metadata"]),
    data: (json["data"] as Array<any>).map(TemplateFromJSON),
  };
}

export function TemplateListToJSON(value?: TemplateList | null): any {
  if (value == null) {
    return value;
  }
  return {
    api_version: value["api_version"],
    kind: value["kind"],
    metadata: CollectionMetadataToJSON(value["metadata"]),
    data: (value["data"] as Array<any>).map(TemplateToJSON),
  };
}
