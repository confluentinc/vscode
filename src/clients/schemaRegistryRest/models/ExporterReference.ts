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
 * The format for a typical exporter object
 * @export
 * @interface ExporterReference
 */
export interface ExporterReference {
    /**
     * Name of the exporter
     * @type {string}
     * @memberof ExporterReference
     */
    name?: string;
    /**
     * Context type of the exporter. One of CUSTOM, NONE or AUTO (default)
     * @type {string}
     * @memberof ExporterReference
     */
    contextType?: string;
    /**
     * Customized context of the exporter if contextType equals CUSTOM.
     * @type {string}
     * @memberof ExporterReference
     */
    context?: string;
    /**
     * Name of each exporter subject
     * @type {Array<string>}
     * @memberof ExporterReference
     */
    subjects?: Array<string>;
    /**
     * Format string for the subject name in the destination cluster, which may contain ${subject} as a placeholder for the originating subject name. For example, dc_${subject} for the subject orders will map to the destination subject name dc_orders.
     * @type {string}
     * @memberof ExporterReference
     */
    subjectRenameFormat?: string;
    /**
     * The map containing exporter’s configurations
     * @type {{ [key: string]: string; }}
     * @memberof ExporterReference
     */
    config?: { [key: string]: string; };
}

/**
 * Check if a given object implements the ExporterReference interface.
 */
export function instanceOfExporterReference(value: object): value is ExporterReference {
    return true;
}

export function ExporterReferenceFromJSON(json: any): ExporterReference {
    return ExporterReferenceFromJSONTyped(json, false);
}

export function ExporterReferenceFromJSONTyped(json: any, ignoreDiscriminator: boolean): ExporterReference {
    if (json == null) {
        return json;
    }
    return {
        
        'name': json['name'] == null ? undefined : json['name'],
        'contextType': json['contextType'] == null ? undefined : json['contextType'],
        'context': json['context'] == null ? undefined : json['context'],
        'subjects': json['subjects'] == null ? undefined : json['subjects'],
        'subjectRenameFormat': json['subjectRenameFormat'] == null ? undefined : json['subjectRenameFormat'],
        'config': json['config'] == null ? undefined : json['config'],
    };
}

export function ExporterReferenceToJSON(value?: ExporterReference | null): any {
    if (value == null) {
        return value;
    }
    return {
        
        'name': value['name'],
        'contextType': value['contextType'],
        'context': value['context'],
        'subjects': value['subjects'],
        'subjectRenameFormat': value['subjectRenameFormat'],
        'config': value['config'],
    };
}

