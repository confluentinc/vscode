/* tslint:disable */
/* eslint-disable */
/**
 * Docker Engine API
 * The Engine API is an HTTP API served by Docker Engine. It is the API the Docker client uses to communicate with the Engine, so everything the Docker client can do can be done with the API.  Most of the client\'s commands map directly to API endpoints (e.g. `docker ps` is `GET /containers/json`). The notable exception is running containers, which consists of several API calls.  # Errors  The API uses standard HTTP status codes to indicate the success or failure of the API call. The body of the response will be JSON in the following format:  ``` {   \"message\": \"page not found\" } ```  # Versioning  The API is usually changed in each release, so API calls are versioned to ensure that clients don\'t break. To lock to a specific version of the API, you prefix the URL with its version, for example, call `/v1.30/info` to use the v1.30 version of the `/info` endpoint. If the API version specified in the URL is not supported by the daemon, a HTTP `400 Bad Request` error message is returned.  If you omit the version-prefix, the current version of the API (v1.43) is used. For example, calling `/info` is the same as calling `/v1.43/info`. Using the API without a version-prefix is deprecated and will be removed in a future release.  Engine releases in the near future should support this version of the API, so your client will continue to work even if it is talking to a newer Engine.  The API uses an open schema model, which means server may add extra properties to responses. Likewise, the server will ignore any extra query parameters and request body properties. When you write clients, you need to ignore additional properties in responses to ensure they do not break when talking to newer daemons.   # Authentication  Authentication for registries is handled client side. The client has to send authentication details to various endpoints that need to communicate with registries, such as `POST /images/(name)/push`. These are sent as `X-Registry-Auth` header as a [base64url encoded](https://tools.ietf.org/html/rfc4648#section-5) (JSON) string with the following structure:  ``` {   \"username\": \"string\",   \"password\": \"string\",   \"email\": \"string\",   \"serveraddress\": \"string\" } ```  The `serveraddress` is a domain/IP without a protocol. Throughout this structure, double quotes are required.  If you have already got an identity token from the [`/auth` endpoint](#operation/SystemAuth), you can just pass this instead of credentials:  ``` {   \"identitytoken\": \"9cbaf023786cd7...\" } ```
 *
 * The version of the OpenAPI document: 1.43
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
 * @interface EndpointPortConfig
 */
export interface EndpointPortConfig {
  /**
   *
   * @type {string}
   * @memberof EndpointPortConfig
   */
  Name?: string;
  /**
   *
   * @type {string}
   * @memberof EndpointPortConfig
   */
  Protocol?: EndpointPortConfigProtocolEnum;
  /**
   * The port inside the container.
   * @type {number}
   * @memberof EndpointPortConfig
   */
  TargetPort?: number;
  /**
   * The port on the swarm hosts.
   * @type {number}
   * @memberof EndpointPortConfig
   */
  PublishedPort?: number;
  /**
   * The mode in which port is published.
   *
   * <p><br /></p>
   *
   * - "ingress" makes the target port accessible on every node,
   *   regardless of whether there is a task for the service running on
   *   that node or not.
   * - "host" bypasses the routing mesh and publish the port directly on
   *   the swarm node where that service is running.
   *
   * @type {string}
   * @memberof EndpointPortConfig
   */
  PublishMode?: EndpointPortConfigPublishModeEnum;
}

/**
 * @export
 * @enum {string}
 */
export enum EndpointPortConfigProtocolEnum {
  Tcp = "tcp",
  Udp = "udp",
  Sctp = "sctp",
}
/**
 * @export
 * @enum {string}
 */
export enum EndpointPortConfigPublishModeEnum {
  Ingress = "ingress",
  Host = "host",
}

/**
 * Check if a given object implements the EndpointPortConfig interface.
 */
export function instanceOfEndpointPortConfig(value: object): value is EndpointPortConfig {
  return true;
}

export function EndpointPortConfigFromJSON(json: any): EndpointPortConfig {
  return EndpointPortConfigFromJSONTyped(json, false);
}

export function EndpointPortConfigFromJSONTyped(
  json: any,
  ignoreDiscriminator: boolean,
): EndpointPortConfig {
  if (json == null) {
    return json;
  }
  return {
    Name: json["Name"] == null ? undefined : json["Name"],
    Protocol: json["Protocol"] == null ? undefined : json["Protocol"],
    TargetPort: json["TargetPort"] == null ? undefined : json["TargetPort"],
    PublishedPort: json["PublishedPort"] == null ? undefined : json["PublishedPort"],
    PublishMode: json["PublishMode"] == null ? undefined : json["PublishMode"],
  };
}

export function EndpointPortConfigToJSON(json: any): EndpointPortConfig {
  return EndpointPortConfigToJSONTyped(json, false);
}

export function EndpointPortConfigToJSONTyped(
  value?: EndpointPortConfig | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    Name: value["Name"],
    Protocol: value["Protocol"],
    TargetPort: value["TargetPort"],
    PublishedPort: value["PublishedPort"],
    PublishMode: value["PublishMode"],
  };
}
