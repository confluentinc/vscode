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
 * BuildCache contains information about a build cache record.
 *
 * @export
 * @interface BuildCache
 */
export interface BuildCache {
  /**
   * Unique ID of the build cache record.
   *
   * @type {string}
   * @memberof BuildCache
   */
  ID?: string;
  /**
   * ID of the parent build cache record.
   *
   * > **Deprecated**: This field is deprecated, and omitted if empty.
   *
   * @type {string}
   * @memberof BuildCache
   */
  Parent?: string | null;
  /**
   * List of parent build cache record IDs.
   *
   * @type {Array<string>}
   * @memberof BuildCache
   */
  Parents?: Array<string> | null;
  /**
   * Cache record type.
   *
   * @type {string}
   * @memberof BuildCache
   */
  Type?: BuildCacheTypeEnum;
  /**
   * Description of the build-step that produced the build cache.
   *
   * @type {string}
   * @memberof BuildCache
   */
  Description?: string;
  /**
   * Indicates if the build cache is in use.
   *
   * @type {boolean}
   * @memberof BuildCache
   */
  InUse?: boolean;
  /**
   * Indicates if the build cache is shared.
   *
   * @type {boolean}
   * @memberof BuildCache
   */
  Shared?: boolean;
  /**
   * Amount of disk space used by the build cache (in bytes).
   *
   * @type {number}
   * @memberof BuildCache
   */
  Size?: number;
  /**
   * Date and time at which the build cache was created in
   * [RFC 3339](https://www.ietf.org/rfc/rfc3339.txt) format with nano-seconds.
   *
   * @type {string}
   * @memberof BuildCache
   */
  CreatedAt?: string;
  /**
   * Date and time at which the build cache was last used in
   * [RFC 3339](https://www.ietf.org/rfc/rfc3339.txt) format with nano-seconds.
   *
   * @type {string}
   * @memberof BuildCache
   */
  LastUsedAt?: string | null;
  /**
   *
   * @type {number}
   * @memberof BuildCache
   */
  UsageCount?: number;
}

/**
 * @export
 */
export const BuildCacheTypeEnum = {
  Internal: "internal",
  Frontend: "frontend",
  SourceLocal: "source.local",
  SourceGitCheckout: "source.git.checkout",
  ExecCachemount: "exec.cachemount",
  Regular: "regular",
} as const;
export type BuildCacheTypeEnum = (typeof BuildCacheTypeEnum)[keyof typeof BuildCacheTypeEnum];

/**
 * Check if a given object implements the BuildCache interface.
 */
export function instanceOfBuildCache(value: object): value is BuildCache {
  return true;
}

export function BuildCacheFromJSON(json: any): BuildCache {
  return BuildCacheFromJSONTyped(json, false);
}

export function BuildCacheFromJSONTyped(json: any, ignoreDiscriminator: boolean): BuildCache {
  if (json == null) {
    return json;
  }
  return {
    ID: json["ID"] == null ? undefined : json["ID"],
    Parent: json["Parent"] == null ? undefined : json["Parent"],
    Parents: json["Parents"] == null ? undefined : json["Parents"],
    Type: json["Type"] == null ? undefined : json["Type"],
    Description: json["Description"] == null ? undefined : json["Description"],
    InUse: json["InUse"] == null ? undefined : json["InUse"],
    Shared: json["Shared"] == null ? undefined : json["Shared"],
    Size: json["Size"] == null ? undefined : json["Size"],
    CreatedAt: json["CreatedAt"] == null ? undefined : json["CreatedAt"],
    LastUsedAt: json["LastUsedAt"] == null ? undefined : json["LastUsedAt"],
    UsageCount: json["UsageCount"] == null ? undefined : json["UsageCount"],
  };
}

export function BuildCacheToJSON(value?: BuildCache | null): any {
  if (value == null) {
    return value;
  }
  return {
    ID: value["ID"],
    Parent: value["Parent"],
    Parents: value["Parents"],
    Type: value["Type"],
    Description: value["Description"],
    InUse: value["InUse"],
    Shared: value["Shared"],
    Size: value["Size"],
    CreatedAt: value["CreatedAt"],
    LastUsedAt: value["LastUsedAt"],
    UsageCount: value["UsageCount"],
  };
}
