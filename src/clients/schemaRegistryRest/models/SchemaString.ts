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
import type { SchemaReference } from "./SchemaReference";
import {
  SchemaReferenceFromJSON,
  SchemaReferenceFromJSONTyped,
  SchemaReferenceToJSON,
} from "./SchemaReference";

/**
 * Schema definition
 * @export
 * @interface SchemaString
 */
export interface SchemaString {
  /**
   * Schema type
   * @type {string}
   * @memberof SchemaString
   */
  schemaType?: string;
  /**
   * Schema string identified by the ID
   * @type {string}
   * @memberof SchemaString
   */
  schema?: string;
  /**
   * References to other schemas
   * @type {Array<SchemaReference>}
   * @memberof SchemaString
   */
  references?: Array<SchemaReference>;
  /**
   * Maximum ID
   * @type {number}
   * @memberof SchemaString
   */
  maxId?: number;
}

/**
 * Check if a given object implements the SchemaString interface.
 */
export function instanceOfSchemaString(value: object): value is SchemaString {
  return true;
}

export function SchemaStringFromJSON(json: any): SchemaString {
  return SchemaStringFromJSONTyped(json, false);
}

export function SchemaStringFromJSONTyped(json: any, ignoreDiscriminator: boolean): SchemaString {
  if (json == null) {
    return json;
  }
  return {
    schemaType: json["schemaType"] == null ? undefined : json["schemaType"],
    schema: json["schema"] == null ? undefined : json["schema"],
    references:
      json["references"] == null
        ? undefined
        : (json["references"] as Array<any>).map(SchemaReferenceFromJSON),
    maxId: json["maxId"] == null ? undefined : json["maxId"],
  };
}

export function SchemaStringToJSON(value?: SchemaString | null): any {
  if (value == null) {
    return value;
  }
  return {
    schemaType: value["schemaType"],
    schema: value["schema"],
    references:
      value["references"] == null
        ? undefined
        : (value["references"] as Array<any>).map(SchemaReferenceToJSON),
    maxId: value["maxId"],
  };
}
