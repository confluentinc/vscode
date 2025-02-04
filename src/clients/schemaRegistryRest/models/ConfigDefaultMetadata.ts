/* tslint:disable */
/* eslint-disable */
/**
 * Confluent Schema Registry APIs
 * REST API for the Schema Registry
 *
 * The version of the OpenAPI document: 1.0.0
 *
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */

import { mapValues } from "../runtime";
/**
 * Default value for the metadata to be used during schema registration.
 * @export
 * @interface ConfigDefaultMetadata
 */
export interface ConfigDefaultMetadata {
  /**
   * The metadata properties and their new values
   * @type {object}
   * @memberof ConfigDefaultMetadata
   */
  properties?: object;
}

/**
 * Check if a given object implements the ConfigDefaultMetadata interface.
 */
export function instanceOfConfigDefaultMetadata(value: object): value is ConfigDefaultMetadata {
  return true;
}

export function ConfigDefaultMetadataFromJSON(json: any): ConfigDefaultMetadata {
  return ConfigDefaultMetadataFromJSONTyped(json, false);
}

export function ConfigDefaultMetadataFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): ConfigDefaultMetadata {
  if (json == null) {
    return json;
  }
  return {
    properties: json["properties"] == null ? undefined : json["properties"],
  };
}

export function ConfigDefaultMetadataToJSON(json: any): ConfigDefaultMetadata {
  return ConfigDefaultMetadataToJSONTyped(json, false);
}

export function ConfigDefaultMetadataToJSONTyped(
  value?: ConfigDefaultMetadata | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    properties: value["properties"],
  };
}
