/* tslint:disable */
/* eslint-disable */
/**
 * Confluent ide-sidecar API
 * API for the Confluent ide-sidecar, part of the Confluent extension for VS Code
 *
 * The version of the OpenAPI document: 1.0.1
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
export const Status = {
  NoToken: "NO_TOKEN",
  ValidToken: "VALID_TOKEN",
  InvalidToken: "INVALID_TOKEN",
} as const;
export type Status = (typeof Status)[keyof typeof Status];

export function instanceOfStatus(value: any): boolean {
  for (const key in Status) {
    if (Object.prototype.hasOwnProperty.call(Status, key)) {
      if ((Status as Record<string, Status>)[key] === value) {
        return true;
      }
    }
  }
  return false;
}

export function StatusFromJSON(json: any): Status {
  return StatusFromJSONTyped(json, false);
}

export function StatusFromJSONTyped(json: any, ignoreDiscriminator: boolean): Status {
  return json as Status;
}

export function StatusToJSON(value?: Status | null): any {
  return value as any;
}
