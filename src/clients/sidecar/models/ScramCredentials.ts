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
import type { HashAlgorithm } from "./HashAlgorithm";
import {
  HashAlgorithmFromJSON,
  HashAlgorithmFromJSONTyped,
  HashAlgorithmToJSON,
  HashAlgorithmToJSONTyped,
} from "./HashAlgorithm";

/**
 * Scram authentication credentials
 * @export
 * @interface ScramCredentials
 */
export interface ScramCredentials {
  /**
   * Hash algorithm
   * @type {HashAlgorithm}
   * @memberof ScramCredentials
   */
  hash_algorithm: HashAlgorithm;
  /**
   * The username to use when connecting to the external service.
   * @type {string}
   * @memberof ScramCredentials
   */
  scram_username: string;
  /**
   * The password to use when connecting to the external service.
   * @type {string}
   * @memberof ScramCredentials
   */
  scram_password: string;
}

/**
 * Check if a given object implements the ScramCredentials interface.
 */
export function instanceOfScramCredentials(value: object): value is ScramCredentials {
  if (!("hash_algorithm" in value) || value["hash_algorithm"] === undefined) return false;
  if (!("scram_username" in value) || value["scram_username"] === undefined) return false;
  if (!("scram_password" in value) || value["scram_password"] === undefined) return false;
  return true;
}

export function ScramCredentialsFromJSON(json: any): ScramCredentials {
  return ScramCredentialsFromJSONTyped(json, false);
}

export function ScramCredentialsFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): ScramCredentials {
  if (json == null) {
    return json;
  }
  return {
    hash_algorithm: HashAlgorithmFromJSON(json["hash_algorithm"]),
    scram_username: json["scram_username"],
    scram_password: json["scram_password"],
  };
}

export function ScramCredentialsToJSON(json: any): ScramCredentials {
  return ScramCredentialsToJSONTyped(json, false);
}

export function ScramCredentialsToJSONTyped(
  value?: ScramCredentials | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    hash_algorithm: HashAlgorithmToJSON(value["hash_algorithm"]),
    scram_username: value["scram_username"],
    scram_password: value["scram_password"],
  };
}
