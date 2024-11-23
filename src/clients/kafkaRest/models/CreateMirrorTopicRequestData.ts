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
import type { ConfigData } from './ConfigData';
import {
    ConfigDataFromJSON,
    ConfigDataFromJSONTyped,
    ConfigDataToJSON,
} from './ConfigData';

/**
 * 
 * @export
 * @interface CreateMirrorTopicRequestData
 */
export interface CreateMirrorTopicRequestData {
    /**
     * 
     * @type {string}
     * @memberof CreateMirrorTopicRequestData
     */
    source_topic_name: string;
    /**
     * 
     * @type {string}
     * @memberof CreateMirrorTopicRequestData
     */
    mirror_topic_name?: string;
    /**
     * 
     * @type {number}
     * @memberof CreateMirrorTopicRequestData
     */
    replication_factor?: number;
    /**
     * 
     * @type {Array<ConfigData>}
     * @memberof CreateMirrorTopicRequestData
     */
    configs?: Array<ConfigData>;
}

/**
 * Check if a given object implements the CreateMirrorTopicRequestData interface.
 */
export function instanceOfCreateMirrorTopicRequestData(value: object): value is CreateMirrorTopicRequestData {
    if (!('source_topic_name' in value) || value['source_topic_name'] === undefined) return false;
    return true;
}

export function CreateMirrorTopicRequestDataFromJSON(json: any): CreateMirrorTopicRequestData {
    return CreateMirrorTopicRequestDataFromJSONTyped(json, false);
}

export function CreateMirrorTopicRequestDataFromJSONTyped(json: any, ignoreDiscriminator: boolean): CreateMirrorTopicRequestData {
    if (json == null) {
        return json;
    }
    return {
        
        'source_topic_name': json['source_topic_name'],
        'mirror_topic_name': json['mirror_topic_name'] == null ? undefined : json['mirror_topic_name'],
        'replication_factor': json['replication_factor'] == null ? undefined : json['replication_factor'],
        'configs': json['configs'] == null ? undefined : ((json['configs'] as Array<any>).map(ConfigDataFromJSON)),
    };
}

export function CreateMirrorTopicRequestDataToJSON(value?: CreateMirrorTopicRequestData | null): any {
    if (value == null) {
        return value;
    }
    return {
        
        'source_topic_name': value['source_topic_name'],
        'mirror_topic_name': value['mirror_topic_name'],
        'replication_factor': value['replication_factor'],
        'configs': value['configs'] == null ? undefined : ((value['configs'] as Array<any>).map(ConfigDataToJSON)),
    };
}

