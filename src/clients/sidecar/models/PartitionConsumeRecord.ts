/* tslint:disable */
/* eslint-disable */
/**
 * Confluent ide-sidecar API
 * API for the Confluent ide-sidecar, part of Confluent for VS Code
 *
 * The version of the OpenAPI document: 1.0.1
 * Contact: vscode@confluent.io
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */

import { mapValues } from '../runtime';
import type { ExceededFields } from './ExceededFields';
import {
    ExceededFieldsFromJSON,
    ExceededFieldsFromJSONTyped,
    ExceededFieldsToJSON,
} from './ExceededFields';
import type { TimestampType } from './TimestampType';
import {
    TimestampTypeFromJSON,
    TimestampTypeFromJSONTyped,
    TimestampTypeToJSON,
} from './TimestampType';
import type { JsonNode } from './JsonNode';
import {
    JsonNodeFromJSON,
    JsonNodeFromJSONTyped,
    JsonNodeToJSON,
} from './JsonNode';
import type { PartitionConsumeRecordHeader } from './PartitionConsumeRecordHeader';
import {
    PartitionConsumeRecordHeaderFromJSON,
    PartitionConsumeRecordHeaderFromJSONTyped,
    PartitionConsumeRecordHeaderToJSON,
} from './PartitionConsumeRecordHeader';

/**
 * 
 * @export
 * @interface PartitionConsumeRecord
 */
export interface PartitionConsumeRecord {
    /**
     * 
     * @type {number}
     * @memberof PartitionConsumeRecord
     */
    partition_id?: number;
    /**
     * 
     * @type {number}
     * @memberof PartitionConsumeRecord
     */
    offset?: number;
    /**
     * 
     * @type {number}
     * @memberof PartitionConsumeRecord
     */
    timestamp?: number;
    /**
     * 
     * @type {TimestampType}
     * @memberof PartitionConsumeRecord
     */
    timestamp_type?: TimestampType;
    /**
     * 
     * @type {Array<PartitionConsumeRecordHeader>}
     * @memberof PartitionConsumeRecord
     */
    headers?: Array<PartitionConsumeRecordHeader>;
    /**
     * 
     * @type {JsonNode}
     * @memberof PartitionConsumeRecord
     */
    key?: JsonNode;
    /**
     * 
     * @type {JsonNode}
     * @memberof PartitionConsumeRecord
     */
    value?: JsonNode;
    /**
     * 
     * @type {string}
     * @memberof PartitionConsumeRecord
     */
    key_decoding_error?: string;
    /**
     * 
     * @type {string}
     * @memberof PartitionConsumeRecord
     */
    value_decoding_error?: string;
    /**
     * 
     * @type {ExceededFields}
     * @memberof PartitionConsumeRecord
     */
    exceeded_fields?: ExceededFields;
}

/**
 * Check if a given object implements the PartitionConsumeRecord interface.
 */
export function instanceOfPartitionConsumeRecord(value: object): value is PartitionConsumeRecord {
    return true;
}

export function PartitionConsumeRecordFromJSON(json: any): PartitionConsumeRecord {
    return PartitionConsumeRecordFromJSONTyped(json, false);
}

export function PartitionConsumeRecordFromJSONTyped(json: any, ignoreDiscriminator: boolean): PartitionConsumeRecord {
    if (json == null) {
        return json;
    }
    return {
        
        'partition_id': json['partition_id'] == null ? undefined : json['partition_id'],
        'offset': json['offset'] == null ? undefined : json['offset'],
        'timestamp': json['timestamp'] == null ? undefined : json['timestamp'],
        'timestamp_type': json['timestamp_type'] == null ? undefined : TimestampTypeFromJSON(json['timestamp_type']),
        'headers': json['headers'] == null ? undefined : ((json['headers'] as Array<any>).map(PartitionConsumeRecordHeaderFromJSON)),
        'key': json['key'] == null ? undefined : JsonNodeFromJSON(json['key']),
        'value': json['value'] == null ? undefined : JsonNodeFromJSON(json['value']),
        'key_decoding_error': json['key_decoding_error'] == null ? undefined : json['key_decoding_error'],
        'value_decoding_error': json['value_decoding_error'] == null ? undefined : json['value_decoding_error'],
        'exceeded_fields': json['exceeded_fields'] == null ? undefined : ExceededFieldsFromJSON(json['exceeded_fields']),
    };
}

export function PartitionConsumeRecordToJSON(value?: PartitionConsumeRecord | null): any {
    if (value == null) {
        return value;
    }
    return {
        
        'partition_id': value['partition_id'],
        'offset': value['offset'],
        'timestamp': value['timestamp'],
        'timestamp_type': TimestampTypeToJSON(value['timestamp_type']),
        'headers': value['headers'] == null ? undefined : ((value['headers'] as Array<any>).map(PartitionConsumeRecordHeaderToJSON)),
        'key': JsonNodeToJSON(value['key']),
        'value': JsonNodeToJSON(value['value']),
        'key_decoding_error': value['key_decoding_error'],
        'value_decoding_error': value['value_decoding_error'],
        'exceeded_fields': ExceededFieldsToJSON(value['exceeded_fields']),
    };
}

