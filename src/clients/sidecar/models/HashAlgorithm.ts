/* tslint:disable */
/* eslint-disable */
/**
 * Confluent ide-sidecar API
 * API for the Confluent ide-sidecar, part of Confluent for VS Code
 *
 * The version of the OpenAPI document: 0.183.0
 * Contact: vscode@confluent.io
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */

/**
 *
 * @export
 */
export const HashAlgorithm = {
  _256: "SCRAM_SHA_256",
  _512: "SCRAM_SHA_512",
} as const;
export type HashAlgorithm = (typeof HashAlgorithm)[keyof typeof HashAlgorithm];

export function instanceOfHashAlgorithm(value: any): boolean {
  for (const key in HashAlgorithm) {
    if (Object.prototype.hasOwnProperty.call(HashAlgorithm, key)) {
      if (HashAlgorithm[key as keyof typeof HashAlgorithm] === value) {
        return true;
      }
    }
  }
  return false;
}

export function HashAlgorithmFromJSON(json: any): HashAlgorithm {
  return HashAlgorithmFromJSONTyped(json, false);
}

export function HashAlgorithmFromJSONTyped(json: any, ignoreDiscriminator: boolean): HashAlgorithm {
  return json as HashAlgorithm;
}

export function HashAlgorithmToJSON(value?: HashAlgorithm | null): any {
  return value as any;
}

export function HashAlgorithmToJSONTyped(value: any, ignoreDiscriminator: boolean): HashAlgorithm {
  return value as HashAlgorithm;
}
