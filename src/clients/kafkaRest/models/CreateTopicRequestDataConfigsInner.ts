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
/**
 * 
 * @export
 * @interface CreateTopicRequestDataConfigsInner
 */
export interface CreateTopicRequestDataConfigsInner {
    /**
     * 
     * @type {string}
     * @memberof CreateTopicRequestDataConfigsInner
     */
    name: string;
    /**
     * 
     * @type {string}
     * @memberof CreateTopicRequestDataConfigsInner
     */
    value?: string | null;
}

/**
 * Check if a given object implements the CreateTopicRequestDataConfigsInner interface.
 */
export function instanceOfCreateTopicRequestDataConfigsInner(value: object): value is CreateTopicRequestDataConfigsInner {
    if (!('name' in value) || value['name'] === undefined) return false;
    return true;
}

export function CreateTopicRequestDataConfigsInnerFromJSON(json: any): CreateTopicRequestDataConfigsInner {
    return CreateTopicRequestDataConfigsInnerFromJSONTyped(json, false);
}

export function CreateTopicRequestDataConfigsInnerFromJSONTyped(json: any, ignoreDiscriminator: boolean): CreateTopicRequestDataConfigsInner {
    if (json == null) {
        return json;
    }
    return {
        
        'name': json['name'],
        'value': json['value'] == null ? undefined : json['value'],
    };
}

export function CreateTopicRequestDataConfigsInnerToJSON(value?: CreateTopicRequestDataConfigsInner | null): any {
    if (value == null) {
        return value;
    }
    return {
        
        'name': value['name'],
        'value': value['value'],
    };
}

