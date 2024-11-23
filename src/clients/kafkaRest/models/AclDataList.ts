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

import { mapValues } from '../runtime';
import type { ResourceCollectionMetadata } from './ResourceCollectionMetadata';
import {
    ResourceCollectionMetadataFromJSON,
    ResourceCollectionMetadataFromJSONTyped,
    ResourceCollectionMetadataToJSON,
} from './ResourceCollectionMetadata';
import type { AclData } from './AclData';
import {
    AclDataFromJSON,
    AclDataFromJSONTyped,
    AclDataToJSON,
} from './AclData';

/**
 * 
 * @export
 * @interface AclDataList
 */
export interface AclDataList {
    /**
     * 
     * @type {string}
     * @memberof AclDataList
     */
    kind: string;
    /**
     * 
     * @type {ResourceCollectionMetadata}
     * @memberof AclDataList
     */
    metadata: ResourceCollectionMetadata;
    /**
     * 
     * @type {Array<AclData>}
     * @memberof AclDataList
     */
    data: Array<AclData>;
}

/**
 * Check if a given object implements the AclDataList interface.
 */
export function instanceOfAclDataList(value: object): value is AclDataList {
    if (!('kind' in value) || value['kind'] === undefined) return false;
    if (!('metadata' in value) || value['metadata'] === undefined) return false;
    if (!('data' in value) || value['data'] === undefined) return false;
    return true;
}

export function AclDataListFromJSON(json: any): AclDataList {
    return AclDataListFromJSONTyped(json, false);
}

export function AclDataListFromJSONTyped(json: any, ignoreDiscriminator: boolean): AclDataList {
    if (json == null) {
        return json;
    }
    return {
        
        'kind': json['kind'],
        'metadata': ResourceCollectionMetadataFromJSON(json['metadata']),
        'data': ((json['data'] as Array<any>).map(AclDataFromJSON)),
    };
}

export function AclDataListToJSON(value?: AclDataList | null): any {
    if (value == null) {
        return value;
    }
    return {
        
        'kind': value['kind'],
        'metadata': ResourceCollectionMetadataToJSON(value['metadata']),
        'data': ((value['data'] as Array<any>).map(AclDataToJSON)),
    };
}

