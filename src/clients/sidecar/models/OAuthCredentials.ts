/* tslint:disable */
/* eslint-disable */
/**
 * Confluent ide-sidecar API
 * API for the Confluent ide-sidecar, part of Confluent for VS Code
 *
 * The version of the OpenAPI document: 0.181.0
 * Contact: vscode@confluent.io
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */

import { mapValues } from "../runtime";
/**
 * OAuth 2.0 authentication credentials
 * @export
 * @interface OAuthCredentials
 */
export interface OAuthCredentials {
  /**
   * The URL of the OAuth 2.0 identity provider's token endpoint.
   * @type {string}
   * @memberof OAuthCredentials
   */
  tokens_url: string;
  /**
   * The public identifier for the application as registered with the OAuth 2.0 identity provider.
   * @type {string}
   * @memberof OAuthCredentials
   */
  client_id: string;
  /**
   * The client secret known only to the application and the OAuth 2.0 identity provider.
   * @type {string}
   * @memberof OAuthCredentials
   */
  client_secret?: string;
  /**
   * The scope to use. The scope is optional and required only when your identity provider doesn't have a default scope or your groups claim is linked to a scope path to use when connecting to the external service.
   * @type {string}
   * @memberof OAuthCredentials
   */
  scope?: string;
  /**
   * The timeout in milliseconds when connecting to your identity provider.
   * @type {number}
   * @memberof OAuthCredentials
   */
  connect_timeout_millis?: number;
  /**
   * Additional property that can be added in the request header to identify the logical cluster ID to connect to. For example, this may be a Confluent Cloud Kafka or Schema Registry cluster ID.
   * @type {string}
   * @memberof OAuthCredentials
   */
  ccloud_logical_cluster_id?: string;
  /**
   * Additional property that can be added in the request header to identify the principal ID for authorization. For example, this may be a Confluent Cloud identity pool ID.
   * @type {string}
   * @memberof OAuthCredentials
   */
  ccloud_identity_pool_id?: string;
}

/**
 * Check if a given object implements the OAuthCredentials interface.
 */
export function instanceOfOAuthCredentials(value: object): value is OAuthCredentials {
  if (!("tokens_url" in value) || value["tokens_url"] === undefined) return false;
  if (!("client_id" in value) || value["client_id"] === undefined) return false;
  return true;
}

export function OAuthCredentialsFromJSON(json: any): OAuthCredentials {
  return OAuthCredentialsFromJSONTyped(json, false);
}

export function OAuthCredentialsFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): OAuthCredentials {
  if (json == null) {
    return json;
  }
  return {
    tokens_url: json["tokens_url"],
    client_id: json["client_id"],
    client_secret: json["client_secret"] == null ? undefined : json["client_secret"],
    scope: json["scope"] == null ? undefined : json["scope"],
    connect_timeout_millis:
      json["connect_timeout_millis"] == null ? undefined : json["connect_timeout_millis"],
    ccloud_logical_cluster_id:
      json["ccloud_logical_cluster_id"] == null ? undefined : json["ccloud_logical_cluster_id"],
    ccloud_identity_pool_id:
      json["ccloud_identity_pool_id"] == null ? undefined : json["ccloud_identity_pool_id"],
  };
}

export function OAuthCredentialsToJSON(json: any): OAuthCredentials {
  return OAuthCredentialsToJSONTyped(json, false);
}

export function OAuthCredentialsToJSONTyped(
  value?: OAuthCredentials | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    tokens_url: value["tokens_url"],
    client_id: value["client_id"],
    client_secret: value["client_secret"],
    scope: value["scope"],
    connect_timeout_millis: value["connect_timeout_millis"],
    ccloud_logical_cluster_id: value["ccloud_logical_cluster_id"],
    ccloud_identity_pool_id: value["ccloud_identity_pool_id"],
  };
}
