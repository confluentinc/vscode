/* tslint:disable */
/* eslint-disable */
/**
 * Confluent ide-sidecar API
 * API for the Confluent ide-sidecar, part of Confluent for VS Code
 *
 * The version of the OpenAPI document: 0.164.0
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
export const ConnectedState = {
  None: "NONE",
  Attempting: "ATTEMPTING",
  Success: "SUCCESS",
  Expired: "EXPIRED",
  Failed: "FAILED",
} as const;
export type ConnectedState = (typeof ConnectedState)[keyof typeof ConnectedState];

export function instanceOfConnectedState(value: any): boolean {
  for (const key in ConnectedState) {
    if (Object.prototype.hasOwnProperty.call(ConnectedState, key)) {
      if (ConnectedState[key as keyof typeof ConnectedState] === value) {
        return true;
      }
    }
  }
  return false;
}

export function ConnectedStateFromJSON(json: any): ConnectedState {
  return ConnectedStateFromJSONTyped(json, false);
}

export function ConnectedStateFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): ConnectedState {
  return json as ConnectedState;
}

export function ConnectedStateToJSON(value?: ConnectedState | null): any {
  return value as any;
}

export function ConnectedStateToJSONTyped(
  value: any,
  ignoreDiscriminator: boolean,
): ConnectedState {
  return value as ConnectedState;
}
