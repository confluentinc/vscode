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
import type { ProduceResponseData } from './ProduceResponseData';
import {
    ProduceResponseDataFromJSON,
    ProduceResponseDataFromJSONTyped,
    ProduceResponseDataToJSON,
} from './ProduceResponseData';

/**
 * 
 * @export
 * @interface ProduceResponse
 */
export interface ProduceResponse {
    /**
     * 
     * @type {number}
     * @memberof ProduceResponse
     */
    error_code: number;
    /**
     * 
     * @type {string}
     * @memberof ProduceResponse
     */
    message?: string;
    /**
     * 
     * @type {string}
     * @memberof ProduceResponse
     */
    cluster_id?: string;
    /**
     * 
     * @type {string}
     * @memberof ProduceResponse
     */
    topic_name?: string;
    /**
     * 
     * @type {number}
     * @memberof ProduceResponse
     */
    partition_id?: number;
    /**
     * 
     * @type {number}
     * @memberof ProduceResponse
     */
    offset?: number;
    /**
     * 
     * @type {Date}
     * @memberof ProduceResponse
     */
    timestamp?: Date | null;
    /**
     * 
     * @type {ProduceResponseData}
     * @memberof ProduceResponse
     */
    key?: ProduceResponseData | null;
    /**
     * 
     * @type {ProduceResponseData}
     * @memberof ProduceResponse
     */
    value?: ProduceResponseData | null;
}

/**
 * Check if a given object implements the ProduceResponse interface.
 */
export function instanceOfProduceResponse(value: object): value is ProduceResponse {
    if (!('error_code' in value) || value['error_code'] === undefined) return false;
    return true;
}

export function ProduceResponseFromJSON(json: any): ProduceResponse {
    return ProduceResponseFromJSONTyped(json, false);
}

export function ProduceResponseFromJSONTyped(json: any, ignoreDiscriminator: boolean): ProduceResponse {
    if (json == null) {
        return json;
    }
    return {
        
        'error_code': json['error_code'],
        'message': json['message'] == null ? undefined : json['message'],
        'cluster_id': json['cluster_id'] == null ? undefined : json['cluster_id'],
        'topic_name': json['topic_name'] == null ? undefined : json['topic_name'],
        'partition_id': json['partition_id'] == null ? undefined : json['partition_id'],
        'offset': json['offset'] == null ? undefined : json['offset'],
        'timestamp': json['timestamp'] == null ? undefined : (new Date(json['timestamp'])),
        'key': json['key'] == null ? undefined : ProduceResponseDataFromJSON(json['key']),
        'value': json['value'] == null ? undefined : ProduceResponseDataFromJSON(json['value']),
    };
}

export function ProduceResponseToJSON(value?: ProduceResponse | null): any {
    if (value == null) {
        return value;
    }
    return {
        
        'error_code': value['error_code'],
        'message': value['message'],
        'cluster_id': value['cluster_id'],
        'topic_name': value['topic_name'],
        'partition_id': value['partition_id'],
        'offset': value['offset'],
        'timestamp': value['timestamp'] == null ? undefined : ((value['timestamp'] as any).toISOString()),
        'key': ProduceResponseDataToJSON(value['key']),
        'value': ProduceResponseDataToJSON(value['value']),
    };
}

