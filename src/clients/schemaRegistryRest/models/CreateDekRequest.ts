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
 * @interface CreateDekRequest
 */
export interface CreateDekRequest {
  /**
   * Subject of the dek
   * @type {string}
   * @memberof CreateDekRequest
   */
  subject?: string;
  /**
   * Version of the dek
   * @type {number}
   * @memberof CreateDekRequest
   */
  version?: number;
  /**
   * Algorithm of the dek
   * @type {string}
   * @memberof CreateDekRequest
   */
  algorithm?: CreateDekRequestAlgorithmEnum;
  /**
   * Encrypted key material of the dek
   * @type {string}
   * @memberof CreateDekRequest
   */
  encryptedKeyMaterial?: string;
  /**
   * Whether the dek is deleted
   * @type {boolean}
   * @memberof CreateDekRequest
   */
  deleted?: boolean;
}

/**
 * @export
 */
export const CreateDekRequestAlgorithmEnum = {
  Aes128Gcm: "AES128_GCM",
  Aes256Gcm: "AES256_GCM",
  Aes256Siv: "AES256_SIV",
} as const;
export type CreateDekRequestAlgorithmEnum =
  (typeof CreateDekRequestAlgorithmEnum)[keyof typeof CreateDekRequestAlgorithmEnum];

/**
 * Check if a given object implements the CreateDekRequest interface.
 */
export function instanceOfCreateDekRequest(value: object): value is CreateDekRequest {
  return true;
}

export function CreateDekRequestFromJSON(json: any): CreateDekRequest {
  return CreateDekRequestFromJSONTyped(json, false);
}

export function CreateDekRequestFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): CreateDekRequest {
  if (json == null) {
    return json;
  }
  return {
    subject: json["subject"] == null ? undefined : json["subject"],
    version: json["version"] == null ? undefined : json["version"],
    algorithm: json["algorithm"] == null ? undefined : json["algorithm"],
    encryptedKeyMaterial:
      json["encryptedKeyMaterial"] == null ? undefined : json["encryptedKeyMaterial"],
    deleted: json["deleted"] == null ? undefined : json["deleted"],
  };
}

export function CreateDekRequestToJSON(value?: CreateDekRequest | null): any {
  if (value == null) {
    return value;
  }
  return {
    subject: value["subject"],
    version: value["version"],
    algorithm: value["algorithm"],
    encryptedKeyMaterial: value["encryptedKeyMaterial"],
    deleted: value["deleted"],
  };
}
