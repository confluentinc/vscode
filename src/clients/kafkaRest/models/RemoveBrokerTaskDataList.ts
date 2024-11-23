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
import type { RemoveBrokerTaskData } from './RemoveBrokerTaskData';
import {
    RemoveBrokerTaskDataFromJSON,
    RemoveBrokerTaskDataFromJSONTyped,
    RemoveBrokerTaskDataToJSON,
} from './RemoveBrokerTaskData';

/**
 * 
 * @export
 * @interface RemoveBrokerTaskDataList
 */
export interface RemoveBrokerTaskDataList {
    /**
     * 
     * @type {string}
     * @memberof RemoveBrokerTaskDataList
     */
    kind: string;
    /**
     * 
     * @type {ResourceCollectionMetadata}
     * @memberof RemoveBrokerTaskDataList
     */
    metadata: ResourceCollectionMetadata;
    /**
     * 
     * @type {Array<RemoveBrokerTaskData>}
     * @memberof RemoveBrokerTaskDataList
     */
    data: Array<RemoveBrokerTaskData>;
}

/**
 * Check if a given object implements the RemoveBrokerTaskDataList interface.
 */
export function instanceOfRemoveBrokerTaskDataList(value: object): value is RemoveBrokerTaskDataList {
    if (!('kind' in value) || value['kind'] === undefined) return false;
    if (!('metadata' in value) || value['metadata'] === undefined) return false;
    if (!('data' in value) || value['data'] === undefined) return false;
    return true;
}

export function RemoveBrokerTaskDataListFromJSON(json: any): RemoveBrokerTaskDataList {
    return RemoveBrokerTaskDataListFromJSONTyped(json, false);
}

export function RemoveBrokerTaskDataListFromJSONTyped(json: any, ignoreDiscriminator: boolean): RemoveBrokerTaskDataList {
    if (json == null) {
        return json;
    }
    return {
        
        'kind': json['kind'],
        'metadata': ResourceCollectionMetadataFromJSON(json['metadata']),
        'data': ((json['data'] as Array<any>).map(RemoveBrokerTaskDataFromJSON)),
    };
}

export function RemoveBrokerTaskDataListToJSON(value?: RemoveBrokerTaskDataList | null): any {
    if (value == null) {
        return value;
    }
    return {
        
        'kind': value['kind'],
        'metadata': ResourceCollectionMetadataToJSON(value['metadata']),
        'data': ((value['data'] as Array<any>).map(RemoveBrokerTaskDataToJSON)),
    };
}

