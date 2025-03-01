/* tslint:disable */
/* eslint-disable */
/**
 * Confluent ide-sidecar API
 * API for the Confluent ide-sidecar, part of Confluent for VS Code
 *
 * The version of the OpenAPI document: 0.163.0
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
export const ConnectionType = {
  Local: "LOCAL",
  Platform: "PLATFORM",
  Ccloud: "CCLOUD",
  Direct: "DIRECT",
} as const;
export type ConnectionType = (typeof ConnectionType)[keyof typeof ConnectionType];

export function instanceOfConnectionType(value: any): boolean {
  for (const key in ConnectionType) {
    if (Object.prototype.hasOwnProperty.call(ConnectionType, key)) {
      if (ConnectionType[key as keyof typeof ConnectionType] === value) {
        return true;
      }
    }
  }
  return false;
}

export function ConnectionTypeFromJSON(json: any): ConnectionType {
  return ConnectionTypeFromJSONTyped(json, false);
}

export function ConnectionTypeFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): ConnectionType {
  return json as ConnectionType;
}

export function ConnectionTypeToJSON(value?: ConnectionType | null): any {
  return value as any;
}

export function ConnectionTypeToJSONTyped(
  value: any,
  ignoreDiscriminator: boolean,
): ConnectionType {
  return value as ConnectionType;
}
