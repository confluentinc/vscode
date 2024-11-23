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
import type { ConfigDefaultMetadata } from './ConfigDefaultMetadata';
import {
    ConfigDefaultMetadataFromJSON,
    ConfigDefaultMetadataFromJSONTyped,
    ConfigDefaultMetadataToJSON,
} from './ConfigDefaultMetadata';
import type { ConfigOverrideMetadata } from './ConfigOverrideMetadata';
import {
    ConfigOverrideMetadataFromJSON,
    ConfigOverrideMetadataFromJSONTyped,
    ConfigOverrideMetadataToJSON,
} from './ConfigOverrideMetadata';
import type { ConfigDefaultRuleSet } from './ConfigDefaultRuleSet';
import {
    ConfigDefaultRuleSetFromJSON,
    ConfigDefaultRuleSetFromJSONTyped,
    ConfigDefaultRuleSetToJSON,
} from './ConfigDefaultRuleSet';
import type { ConfigOverrideRuleSet } from './ConfigOverrideRuleSet';
import {
    ConfigOverrideRuleSetFromJSON,
    ConfigOverrideRuleSetFromJSONTyped,
    ConfigOverrideRuleSetToJSON,
} from './ConfigOverrideRuleSet';

/**
 * Config
 * @export
 * @interface Config
 */
export interface Config {
    /**
     * If alias is specified, then this subject is an alias for the subject
     * named by the alias. That means that any reference to this subject
     * will be replaced by the alias.
     * @type {string}
     * @memberof Config
     */
    alias?: string;
    /**
     * If true, then schemas are automatically normalized when registered or
     * when passed during lookups. This means that clients do not have to
     * pass the "normalize" query parameter to have normalization occur.
     * @type {boolean}
     * @memberof Config
     */
    normalize?: boolean;
    /**
     * Compatibility Level
     * @type {string}
     * @memberof Config
     */
    compatibilityLevel?: string;
    /**
     * Only schemas that belong to the same compatibility group will be
     * checked for compatibility.
     * @type {string}
     * @memberof Config
     */
    compatibilityGroup?: string;
    /**
     * 
     * @type {ConfigDefaultMetadata}
     * @memberof Config
     */
    defaultMetadata?: ConfigDefaultMetadata;
    /**
     * 
     * @type {ConfigOverrideMetadata}
     * @memberof Config
     */
    overrideMetadata?: ConfigOverrideMetadata;
    /**
     * 
     * @type {ConfigDefaultRuleSet}
     * @memberof Config
     */
    defaultRuleSet?: ConfigDefaultRuleSet;
    /**
     * 
     * @type {ConfigOverrideRuleSet}
     * @memberof Config
     */
    overrideRuleSet?: ConfigOverrideRuleSet;
}

/**
 * Check if a given object implements the Config interface.
 */
export function instanceOfConfig(value: object): value is Config {
    return true;
}

export function ConfigFromJSON(json: any): Config {
    return ConfigFromJSONTyped(json, false);
}

export function ConfigFromJSONTyped(json: any, ignoreDiscriminator: boolean): Config {
    if (json == null) {
        return json;
    }
    return {
        
        'alias': json['alias'] == null ? undefined : json['alias'],
        'normalize': json['normalize'] == null ? undefined : json['normalize'],
        'compatibilityLevel': json['compatibilityLevel'] == null ? undefined : json['compatibilityLevel'],
        'compatibilityGroup': json['compatibilityGroup'] == null ? undefined : json['compatibilityGroup'],
        'defaultMetadata': json['defaultMetadata'] == null ? undefined : ConfigDefaultMetadataFromJSON(json['defaultMetadata']),
        'overrideMetadata': json['overrideMetadata'] == null ? undefined : ConfigOverrideMetadataFromJSON(json['overrideMetadata']),
        'defaultRuleSet': json['defaultRuleSet'] == null ? undefined : ConfigDefaultRuleSetFromJSON(json['defaultRuleSet']),
        'overrideRuleSet': json['overrideRuleSet'] == null ? undefined : ConfigOverrideRuleSetFromJSON(json['overrideRuleSet']),
    };
}

export function ConfigToJSON(value?: Config | null): any {
    if (value == null) {
        return value;
    }
    return {
        
        'alias': value['alias'],
        'normalize': value['normalize'],
        'compatibilityLevel': value['compatibilityLevel'],
        'compatibilityGroup': value['compatibilityGroup'],
        'defaultMetadata': ConfigDefaultMetadataToJSON(value['defaultMetadata']),
        'overrideMetadata': ConfigOverrideMetadataToJSON(value['overrideMetadata']),
        'defaultRuleSet': ConfigDefaultRuleSetToJSON(value['defaultRuleSet']),
        'overrideRuleSet': ConfigOverrideRuleSetToJSON(value['overrideRuleSet']),
    };
}

