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

import { mapValues } from "../runtime";
/**
 *
 * @export
 * @interface AlterMirrorsRequestData
 */
export interface AlterMirrorsRequestData {
  /**
   * The mirror topics specified as a list of topic names.
   * @type {Array<string>}
   * @memberof AlterMirrorsRequestData
   */
  mirror_topic_names?: Array<string>;
  /**
   * The mirror topics specified as a pattern.
   * @type {string}
   * @memberof AlterMirrorsRequestData
   */
  mirror_topic_name_pattern?: string;
}

/**
 * Check if a given object implements the AlterMirrorsRequestData interface.
 */
export function instanceOfAlterMirrorsRequestData(value: object): value is AlterMirrorsRequestData {
  return true;
}

export function AlterMirrorsRequestDataFromJSON(json: any): AlterMirrorsRequestData {
  return AlterMirrorsRequestDataFromJSONTyped(json, false);
}

export function AlterMirrorsRequestDataFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): AlterMirrorsRequestData {
  if (json == null) {
    return json;
  }
  return {
    mirror_topic_names: json["mirror_topic_names"] == null ? undefined : json["mirror_topic_names"],
    mirror_topic_name_pattern:
      json["mirror_topic_name_pattern"] == null ? undefined : json["mirror_topic_name_pattern"],
  };
}

export function AlterMirrorsRequestDataToJSON(value?: AlterMirrorsRequestData | null): any {
  if (value == null) {
    return value;
  }
  return {
    mirror_topic_names: value["mirror_topic_names"],
    mirror_topic_name_pattern: value["mirror_topic_name_pattern"],
  };
}
