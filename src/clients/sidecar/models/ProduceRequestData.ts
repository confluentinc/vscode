/* tslint:disable */
/* eslint-disable */
/**
 * Confluent ide-sidecar API
 * API for the Confluent ide-sidecar, part of Confluent for VS Code
 *
 * The version of the OpenAPI document: 0.166.0
 * Contact: vscode@confluent.io
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */

/**
 *
 * @export
 * @interface ProduceRequestData
 */
export interface ProduceRequestData {
  /**
   *
   * @type {string}
   * @memberof ProduceRequestData
   */
  type?: string;
  /**
   *
   * @type {string}
   * @memberof ProduceRequestData
   */
  subject?: string;
  /**
   *
   * @type {string}
   * @memberof ProduceRequestData
   */
  subject_name_strategy?: string;
  /**
   *
   * @type {number}
   * @memberof ProduceRequestData
   */
  schema_id?: number;
  /**
   *
   * @type {number}
   * @memberof ProduceRequestData
   */
  schema_version?: number;
  /**
   *
   * @type {string}
   * @memberof ProduceRequestData
   */
  schema?: string;
  /**
   *
   * @type {any}
   * @memberof ProduceRequestData
   */
  data?: any | null;
}

/**
 * Check if a given object implements the ProduceRequestData interface.
 */
export function instanceOfProduceRequestData(value: object): value is ProduceRequestData {
  return true;
}

export function ProduceRequestDataFromJSON(json: any): ProduceRequestData {
  return ProduceRequestDataFromJSONTyped(json, false);
}

export function ProduceRequestDataFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): ProduceRequestData {
  if (json == null) {
    return json;
  }
  return {
    type: json["type"] == null ? undefined : json["type"],
    subject: json["subject"] == null ? undefined : json["subject"],
    subject_name_strategy:
      json["subject_name_strategy"] == null ? undefined : json["subject_name_strategy"],
    schema_id: json["schema_id"] == null ? undefined : json["schema_id"],
    schema_version: json["schema_version"] == null ? undefined : json["schema_version"],
    schema: json["schema"] == null ? undefined : json["schema"],
    data: json["data"] == null ? undefined : json["data"],
  };
}

export function ProduceRequestDataToJSON(json: any): ProduceRequestData {
  return ProduceRequestDataToJSONTyped(json, false);
}

export function ProduceRequestDataToJSONTyped(
  value?: ProduceRequestData | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    type: value["type"],
    subject: value["subject"],
    subject_name_strategy: value["subject_name_strategy"],
    schema_id: value["schema_id"],
    schema_version: value["schema_version"],
    schema: value["schema"],
    data: value["data"],
  };
}
