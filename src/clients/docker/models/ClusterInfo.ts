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
import type { ObjectVersion } from "./ObjectVersion";
import {
  ObjectVersionFromJSON,
  ObjectVersionFromJSONTyped,
  ObjectVersionToJSON,
  ObjectVersionToJSONTyped,
} from "./ObjectVersion";
import type { TLSInfo } from "./TLSInfo";
import {
  TLSInfoFromJSON,
  TLSInfoFromJSONTyped,
  TLSInfoToJSON,
  TLSInfoToJSONTyped,
} from "./TLSInfo";
import type { SwarmSpec } from "./SwarmSpec";
import {
  SwarmSpecFromJSON,
  SwarmSpecFromJSONTyped,
  SwarmSpecToJSON,
  SwarmSpecToJSONTyped,
} from "./SwarmSpec";

/**
 * ClusterInfo represents information about the swarm as is returned by the
 * "/info" endpoint. Join-tokens are not included.
 *
 * @export
 * @interface ClusterInfo
 */
export interface ClusterInfo {
  /**
   * The ID of the swarm.
   * @type {string}
   * @memberof ClusterInfo
   */
  ID?: string;
  /**
   *
   * @type {ObjectVersion}
   * @memberof ClusterInfo
   */
  Version?: ObjectVersion;
  /**
   * Date and time at which the swarm was initialised in
   * [RFC 3339](https://www.ietf.org/rfc/rfc3339.txt) format with nano-seconds.
   *
   * @type {string}
   * @memberof ClusterInfo
   */
  CreatedAt?: string;
  /**
   * Date and time at which the swarm was last updated in
   * [RFC 3339](https://www.ietf.org/rfc/rfc3339.txt) format with nano-seconds.
   *
   * @type {string}
   * @memberof ClusterInfo
   */
  UpdatedAt?: string;
  /**
   *
   * @type {SwarmSpec}
   * @memberof ClusterInfo
   */
  Spec?: SwarmSpec;
  /**
   *
   * @type {TLSInfo}
   * @memberof ClusterInfo
   */
  TLSInfo?: TLSInfo;
  /**
   * Whether there is currently a root CA rotation in progress for the swarm
   *
   * @type {boolean}
   * @memberof ClusterInfo
   */
  RootRotationInProgress?: boolean;
  /**
   * DataPathPort specifies the data path port number for data traffic.
   * Acceptable port range is 1024 to 49151.
   * If no port is set or is set to 0, the default port (4789) is used.
   *
   * @type {number}
   * @memberof ClusterInfo
   */
  DataPathPort?: number;
  /**
   * Default Address Pool specifies default subnet pools for global scope
   * networks.
   *
   * @type {Array<string>}
   * @memberof ClusterInfo
   */
  DefaultAddrPool?: Array<string>;
  /**
   * SubnetSize specifies the subnet size of the networks created from the
   * default subnet pool.
   *
   * @type {number}
   * @memberof ClusterInfo
   */
  SubnetSize?: number;
}

/**
 * Check if a given object implements the ClusterInfo interface.
 */
export function instanceOfClusterInfo(value: object): value is ClusterInfo {
  return true;
}

export function ClusterInfoFromJSON(json: any): ClusterInfo {
  return ClusterInfoFromJSONTyped(json, false);
}

export function ClusterInfoFromJSONTyped(json: any, ignoreDiscriminator: boolean): ClusterInfo {
  if (json == null) {
    return json;
  }
  return {
    ID: json["ID"] == null ? undefined : json["ID"],
    Version: json["Version"] == null ? undefined : ObjectVersionFromJSON(json["Version"]),
    CreatedAt: json["CreatedAt"] == null ? undefined : json["CreatedAt"],
    UpdatedAt: json["UpdatedAt"] == null ? undefined : json["UpdatedAt"],
    Spec: json["Spec"] == null ? undefined : SwarmSpecFromJSON(json["Spec"]),
    TLSInfo: json["TLSInfo"] == null ? undefined : TLSInfoFromJSON(json["TLSInfo"]),
    RootRotationInProgress:
      json["RootRotationInProgress"] == null ? undefined : json["RootRotationInProgress"],
    DataPathPort: json["DataPathPort"] == null ? undefined : json["DataPathPort"],
    DefaultAddrPool: json["DefaultAddrPool"] == null ? undefined : json["DefaultAddrPool"],
    SubnetSize: json["SubnetSize"] == null ? undefined : json["SubnetSize"],
  };
}

export function ClusterInfoToJSON(json: any): ClusterInfo {
  return ClusterInfoToJSONTyped(json, false);
}

export function ClusterInfoToJSONTyped(
  value?: ClusterInfo | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    ID: value["ID"],
    Version: ObjectVersionToJSON(value["Version"]),
    CreatedAt: value["CreatedAt"],
    UpdatedAt: value["UpdatedAt"],
    Spec: SwarmSpecToJSON(value["Spec"]),
    TLSInfo: TLSInfoToJSON(value["TLSInfo"]),
    RootRotationInProgress: value["RootRotationInProgress"],
    DataPathPort: value["DataPathPort"],
    DefaultAddrPool: value["DefaultAddrPool"],
    SubnetSize: value["SubnetSize"],
  };
}
