/* tslint:disable */
/* eslint-disable */
/**
 * REST Admin API
 * No description provided (generated by Openapi Generator https://github.com/openapitools/openapi-generator)
 *
 * The version of the OpenAPI document: 3.0.0
 *
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
export enum AclResourceType {
  Unknown = "UNKNOWN",
  Any = "ANY",
  Topic = "TOPIC",
  Group = "GROUP",
  Cluster = "CLUSTER",
  TransactionalId = "TRANSACTIONAL_ID",
  DelegationToken = "DELEGATION_TOKEN",
}

export function instanceOfAclResourceType(value: any): boolean {
  for (const key in AclResourceType) {
    if (Object.prototype.hasOwnProperty.call(AclResourceType, key)) {
      if (AclResourceType[key as keyof typeof AclResourceType] === value) {
        return true;
      }
    }
  }
  return false;
}

export function AclResourceTypeFromJSON(json: any): AclResourceType {
  return AclResourceTypeFromJSONTyped(json, false);
}

export function AclResourceTypeFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): AclResourceType {
  return json as AclResourceType;
}

export function AclResourceTypeToJSON(value?: AclResourceType | null): any {
  return value as any;
}

export function AclResourceTypeToJSONTyped(
  value: any,
  ignoreDiscriminator: boolean,
): AclResourceType {
  return value as AclResourceType;
}
