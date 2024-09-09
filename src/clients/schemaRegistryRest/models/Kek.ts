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
 *
 * @export
 * @interface Kek
 */
export interface Kek {
  /**
   * Name of the kek
   * @type {string}
   * @memberof Kek
   */
  name?: string;
  /**
   * KMS type of the kek
   * @type {string}
   * @memberof Kek
   */
  kmsType?: string;
  /**
   * KMS key ID of the kek
   * @type {string}
   * @memberof Kek
   */
  kmsKeyId?: string;
  /**
   * Properties of the kek
   * @type {{ [key: string]: string; }}
   * @memberof Kek
   */
  kmsProps?: { [key: string]: string };
  /**
   * Description of the kek
   * @type {string}
   * @memberof Kek
   */
  doc?: string;
  /**
   * Whether the kek is shared
   * @type {boolean}
   * @memberof Kek
   */
  shared?: boolean;
  /**
   * Timestamp of the kek
   * @type {number}
   * @memberof Kek
   */
  ts?: number;
  /**
   * Whether the kek is deleted
   * @type {boolean}
   * @memberof Kek
   */
  deleted?: boolean;
}

/**
 * Check if a given object implements the Kek interface.
 */
export function instanceOfKek(value: object): value is Kek {
  return true;
}

export function KekFromJSON(json: any): Kek {
  return KekFromJSONTyped(json, false);
}

export function KekFromJSONTyped(json: any, ignoreDiscriminator: boolean): Kek {
  if (json == null) {
    return json;
  }
  return {
    name: json["name"] == null ? undefined : json["name"],
    kmsType: json["kmsType"] == null ? undefined : json["kmsType"],
    kmsKeyId: json["kmsKeyId"] == null ? undefined : json["kmsKeyId"],
    kmsProps: json["kmsProps"] == null ? undefined : json["kmsProps"],
    doc: json["doc"] == null ? undefined : json["doc"],
    shared: json["shared"] == null ? undefined : json["shared"],
    ts: json["ts"] == null ? undefined : json["ts"],
    deleted: json["deleted"] == null ? undefined : json["deleted"],
  };
}

export function KekToJSON(value?: Kek | null): any {
  if (value == null) {
    return value;
  }
  return {
    name: value["name"],
    kmsType: value["kmsType"],
    kmsKeyId: value["kmsKeyId"],
    kmsProps: value["kmsProps"],
    doc: value["doc"],
    shared: value["shared"],
    ts: value["ts"],
    deleted: value["deleted"],
  };
}
