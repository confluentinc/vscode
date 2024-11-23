/* tslint:disable */
/* eslint-disable */
/**
 * Confluent Schema Registry APIs
 * REST API for the Schema Registry
 *
 * The version of the OpenAPI document: 1.0.0
 * 
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */

import { mapValues } from '../runtime';
/**
 * User-defined metadata
 * @export
 * @interface Metadata
 */
export interface Metadata {
    /**
     * 
     * @type {{ [key: string]: Set<string>; }}
     * @memberof Metadata
     */
    tags?: { [key: string]: Set<string>; };
    /**
     * 
     * @type {{ [key: string]: string; }}
     * @memberof Metadata
     */
    properties?: { [key: string]: string; };
    /**
     * 
     * @type {Set<string>}
     * @memberof Metadata
     */
    sensitive?: Set<string>;
}

/**
 * Check if a given object implements the Metadata interface.
 */
export function instanceOfMetadata(value: object): value is Metadata {
    return true;
}

export function MetadataFromJSON(json: any): Metadata {
    return MetadataFromJSONTyped(json, false);
}

export function MetadataFromJSONTyped(json: any, ignoreDiscriminator: boolean): Metadata {
    if (json == null) {
        return json;
    }
    return {
        
        'tags': json['tags'] == null ? undefined : json['tags'],
        'properties': json['properties'] == null ? undefined : json['properties'],
        'sensitive': json['sensitive'] == null ? undefined : json['sensitive'],
    };
}

export function MetadataToJSON(value?: Metadata | null): any {
    if (value == null) {
        return value;
    }
    return {
        
        'tags': value['tags'],
        'properties': value['properties'],
        'sensitive': value['sensitive'] == null ? undefined : Array.from(value['sensitive'] as Set<any>),
    };
}

