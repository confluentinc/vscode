/* tslint:disable */
/* eslint-disable */
/**
 * Confluent ide-sidecar API
 * API for the Confluent ide-sidecar, part of Confluent for VS Code
 *
 * The version of the OpenAPI document: 0.187.0
 * Contact: vscode@confluent.io
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */

/**
 *
 * @export
 * @enum {string}
 */
export enum JsonNodeType {
  Array = "ARRAY",
  Binary = "BINARY",
  Boolean = "BOOLEAN",
  Missing = "MISSING",
  Null = "NULL",
  Number = "NUMBER",
  Object = "OBJECT",
  Pojo = "POJO",
  String = "STRING",
}

export function instanceOfJsonNodeType(value: any): boolean {
  for (const key in JsonNodeType) {
    if (Object.prototype.hasOwnProperty.call(JsonNodeType, key)) {
      if (JsonNodeType[key as keyof typeof JsonNodeType] === value) {
        return true;
      }
    }
  }
  return false;
}

export function JsonNodeTypeFromJSON(json: any): JsonNodeType {
  return JsonNodeTypeFromJSONTyped(json, false);
}

export function JsonNodeTypeFromJSONTyped(json: any, ignoreDiscriminator: boolean): JsonNodeType {
  return json as JsonNodeType;
}

export function JsonNodeTypeToJSON(value?: JsonNodeType | null): any {
  return value as any;
}

export function JsonNodeTypeToJSONTyped(value: any, ignoreDiscriminator: boolean): JsonNodeType {
  return value as JsonNodeType;
}
