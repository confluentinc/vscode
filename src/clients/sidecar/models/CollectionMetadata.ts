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
/**
 *
 * @export
 * @interface CollectionMetadata
 */
export interface CollectionMetadata {
  /**
   *
   * @type {string}
   * @memberof CollectionMetadata
   */
  self?: string;
  /**
   *
   * @type {string}
   * @memberof CollectionMetadata
   */
  next?: string;
  /**
   *
   * @type {number}
   * @memberof CollectionMetadata
   */
  total_size?: number;
}

/**
 * Check if a given object implements the CollectionMetadata interface.
 */
export function instanceOfCollectionMetadata(value: object): value is CollectionMetadata {
  return true;
}

export function CollectionMetadataFromJSON(json: any): CollectionMetadata {
  return CollectionMetadataFromJSONTyped(json, false);
}

export function CollectionMetadataFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): CollectionMetadata {
  if (json == null) {
    return json;
  }
  return {
    self: json["self"] == null ? undefined : json["self"],
    next: json["next"] == null ? undefined : json["next"],
    total_size: json["total_size"] == null ? undefined : json["total_size"],
  };
}

export function CollectionMetadataToJSON(value?: CollectionMetadata | null): any {
  if (value == null) {
    return value;
  }
  return {
    self: value["self"],
    next: value["next"],
    total_size: value["total_size"],
  };
}
