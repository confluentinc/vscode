/* tslint:disable */
/* eslint-disable */
/**
 * Docker Engine API
 * The Engine API is an HTTP API served by Docker Engine. It is the API the Docker client uses to communicate with the Engine, so everything the Docker client can do can be done with the API.  Most of the client\'s commands map directly to API endpoints (e.g. `docker ps` is `GET /containers/json`). The notable exception is running containers, which consists of several API calls.  # Errors  The API uses standard HTTP status codes to indicate the success or failure of the API call. The body of the response will be JSON in the following format:  ``` {   \"message\": \"page not found\" } ```  # Versioning  The API is usually changed in each release, so API calls are versioned to ensure that clients don\'t break. To lock to a specific version of the API, you prefix the URL with its version, for example, call `/v1.30/info` to use the v1.30 version of the `/info` endpoint. If the API version specified in the URL is not supported by the daemon, a HTTP `400 Bad Request` error message is returned.  If you omit the version-prefix, the current version of the API (v1.47) is used. For example, calling `/info` is the same as calling `/v1.47/info`. Using the API without a version-prefix is deprecated and will be removed in a future release.  Engine releases in the near future should support this version of the API, so your client will continue to work even if it is talking to a newer Engine.  The API uses an open schema model, which means server may add extra properties to responses. Likewise, the server will ignore any extra query parameters and request body properties. When you write clients, you need to ignore additional properties in responses to ensure they do not break when talking to newer daemons.   # Authentication  Authentication for registries is handled client side. The client has to send authentication details to various endpoints that need to communicate with registries, such as `POST /images/(name)/push`. These are sent as `X-Registry-Auth` header as a [base64url encoded](https://tools.ietf.org/html/rfc4648#section-5) (JSON) string with the following structure:  ``` {   \"username\": \"string\",   \"password\": \"string\",   \"email\": \"string\",   \"serveraddress\": \"string\" } ```  The `serveraddress` is a domain/IP without a protocol. Throughout this structure, double quotes are required.  If you have already got an identity token from the [`/auth` endpoint](#operation/SystemAuth), you can just pass this instead of credentials:  ``` {   \"identitytoken\": \"9cbaf023786cd7...\" } ```
 *
 * The version of the OpenAPI document: 1.47
 *
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */

import { mapValues } from "../runtime";
import type { PluginInterfaceType } from "./PluginInterfaceType";
import {
  PluginInterfaceTypeFromJSON,
  PluginInterfaceTypeFromJSONTyped,
  PluginInterfaceTypeToJSON,
} from "./PluginInterfaceType";

/**
 * The interface between Docker and the plugin
 * @export
 * @interface PluginConfigInterface
 */
export interface PluginConfigInterface {
  /**
   *
   * @type {Array<PluginInterfaceType>}
   * @memberof PluginConfigInterface
   */
  Types: Array<PluginInterfaceType>;
  /**
   *
   * @type {string}
   * @memberof PluginConfigInterface
   */
  Socket: string;
  /**
   * Protocol to use for clients connecting to the plugin.
   * @type {string}
   * @memberof PluginConfigInterface
   */
  ProtocolScheme?: PluginConfigInterfaceProtocolSchemeEnum;
}

/**
 * @export
 */
export const PluginConfigInterfaceProtocolSchemeEnum = {
  Empty: "",
  MobyPluginsHttpV1: "moby.plugins.http/v1",
} as const;
export type PluginConfigInterfaceProtocolSchemeEnum =
  (typeof PluginConfigInterfaceProtocolSchemeEnum)[keyof typeof PluginConfigInterfaceProtocolSchemeEnum];

/**
 * Check if a given object implements the PluginConfigInterface interface.
 */
export function instanceOfPluginConfigInterface(value: object): value is PluginConfigInterface {
  if (!("Types" in value) || value["Types"] === undefined) return false;
  if (!("Socket" in value) || value["Socket"] === undefined) return false;
  return true;
}

export function PluginConfigInterfaceFromJSON(json: any): PluginConfigInterface {
  return PluginConfigInterfaceFromJSONTyped(json, false);
}

export function PluginConfigInterfaceFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): PluginConfigInterface {
  if (json == null) {
    return json;
  }
  return {
    Types: (json["Types"] as Array<any>).map(PluginInterfaceTypeFromJSON),
    Socket: json["Socket"],
    ProtocolScheme: json["ProtocolScheme"] == null ? undefined : json["ProtocolScheme"],
  };
}

export function PluginConfigInterfaceToJSON(value?: PluginConfigInterface | null): any {
  if (value == null) {
    return value;
  }
  return {
    Types: (value["Types"] as Array<any>).map(PluginInterfaceTypeToJSON),
    Socket: value["Socket"],
    ProtocolScheme: value["ProtocolScheme"],
  };
}
