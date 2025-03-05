/* tslint:disable */
/* eslint-disable */
/**
 * Confluent ide-sidecar API
 * API for the Confluent ide-sidecar, part of Confluent for VS Code
 *
 * The version of the OpenAPI document: 0.165.0
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
export const TimestampType = {
  NoTimestampType: "NO_TIMESTAMP_TYPE",
  CreateTime: "CREATE_TIME",
  LogAppendTime: "LOG_APPEND_TIME",
} as const;
export type TimestampType = (typeof TimestampType)[keyof typeof TimestampType];

export function instanceOfTimestampType(value: any): boolean {
  for (const key in TimestampType) {
    if (Object.prototype.hasOwnProperty.call(TimestampType, key)) {
      if (TimestampType[key as keyof typeof TimestampType] === value) {
        return true;
      }
    }
  }
  return false;
}

export function TimestampTypeFromJSON(json: any): TimestampType {
  return TimestampTypeFromJSONTyped(json, false);
}

export function TimestampTypeFromJSONTyped(json: any, ignoreDiscriminator: boolean): TimestampType {
  return json as TimestampType;
}

export function TimestampTypeToJSON(value?: TimestampType | null): any {
  return value as any;
}

export function TimestampTypeToJSONTyped(value: any, ignoreDiscriminator: boolean): TimestampType {
  return value as TimestampType;
}
