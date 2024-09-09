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

import { mapValues } from "../runtime";
/**
 * Exporter status get request
 * @export
 * @interface ExporterStatusResponse
 */
export interface ExporterStatusResponse {
  /**
   * Name of exporter.
   * @type {string}
   * @memberof ExporterStatusResponse
   */
  name?: string;
  /**
   * State of the exporter. Could be STARTING, RUNNING or PAUSED
   * @type {string}
   * @memberof ExporterStatusResponse
   */
  state?: string;
  /**
   * Offset of the exporter
   * @type {number}
   * @memberof ExporterStatusResponse
   */
  offset?: number;
  /**
   * Timestamp of the exporter
   * @type {number}
   * @memberof ExporterStatusResponse
   */
  ts?: number;
  /**
   * Error trace of the exporter
   * @type {string}
   * @memberof ExporterStatusResponse
   */
  trace?: string;
}

/**
 * Check if a given object implements the ExporterStatusResponse interface.
 */
export function instanceOfExporterStatusResponse(value: object): value is ExporterStatusResponse {
  return true;
}

export function ExporterStatusResponseFromJSON(json: any): ExporterStatusResponse {
  return ExporterStatusResponseFromJSONTyped(json, false);
}

export function ExporterStatusResponseFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): ExporterStatusResponse {
  if (json == null) {
    return json;
  }
  return {
    name: json["name"] == null ? undefined : json["name"],
    state: json["state"] == null ? undefined : json["state"],
    offset: json["offset"] == null ? undefined : json["offset"],
    ts: json["ts"] == null ? undefined : json["ts"],
    trace: json["trace"] == null ? undefined : json["trace"],
  };
}

export function ExporterStatusResponseToJSON(value?: ExporterStatusResponse | null): any {
  if (value == null) {
    return value;
  }
  return {
    name: value["name"],
    state: value["state"],
    offset: value["offset"],
    ts: value["ts"],
    trace: value["trace"],
  };
}
