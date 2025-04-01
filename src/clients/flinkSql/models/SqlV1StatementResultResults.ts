/* tslint:disable */
/* eslint-disable */
/**
 * SQL API v1
 * No description provided (generated by Openapi Generator https://github.com/openapitools/openapi-generator)
 *
 * The version of the OpenAPI document: 0.0.1
 *
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */

import { mapValues } from "../runtime";
/**
 * A results property that contains a data property that contains an array of results.
 * @export
 * @interface SqlV1StatementResultResults
 */
export interface SqlV1StatementResultResults {
  /**
   * A data property that contains an array of results. Each entry in the array is a separate result.
   *
   * The value of `op` attribute (if present) represents the kind of change that a row can describe in a changelog:
   *
   * `0`: represents `INSERT` (`+I`), i.e. insertion operation;
   *
   * `1`: represents `UPDATE_BEFORE` (`-U`), i.e. update operation with the previous content of the updated row.
   * This kind should occur together with `UPDATE_AFTER` for modelling an update that needs to retract
   * the previous row first. It is useful in cases of a non-idempotent update, i.e., an update of a row that is not
   * uniquely identifiable by a key;
   *
   * `2`: represents `UPDATE_AFTER` (`+U`), i.e. update operation with new content of the updated row;
   * This kind CAN occur together with `UPDATE_BEFORE` for modelling an update that
   * needs to retract the previous row first or it describes an idempotent update, i.e., an
   * update of a row that is uniquely identifiable by a key;
   *
   * `3`: represents `DELETE` (`-D`), i.e. deletion operation;
   *
   * Defaults to `0`.
   *
   * @type {Array<any>}
   * @memberof SqlV1StatementResultResults
   */
  data?: Array<any>;
}

/**
 * Check if a given object implements the SqlV1StatementResultResults interface.
 */
export function instanceOfSqlV1StatementResultResults(
  value: object,
): value is SqlV1StatementResultResults {
  return true;
}

export function SqlV1StatementResultResultsFromJSON(json: any): SqlV1StatementResultResults {
  return SqlV1StatementResultResultsFromJSONTyped(json, false);
}

export function SqlV1StatementResultResultsFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): SqlV1StatementResultResults {
  if (json == null) {
    return json;
  }
  return {
    data: json["data"] == null ? undefined : json["data"],
  };
}

export function SqlV1StatementResultResultsToJSON(json: any): SqlV1StatementResultResults {
  return SqlV1StatementResultResultsToJSONTyped(json, false);
}

export function SqlV1StatementResultResultsToJSONTyped(
  value?: SqlV1StatementResultResults | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    data: value["data"],
  };
}
