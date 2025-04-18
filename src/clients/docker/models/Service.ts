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
import type { ServiceServiceStatus } from "./ServiceServiceStatus";
import {
  ServiceServiceStatusFromJSON,
  ServiceServiceStatusFromJSONTyped,
  ServiceServiceStatusToJSON,
  ServiceServiceStatusToJSONTyped,
} from "./ServiceServiceStatus";
import type { ServiceJobStatus } from "./ServiceJobStatus";
import {
  ServiceJobStatusFromJSON,
  ServiceJobStatusFromJSONTyped,
  ServiceJobStatusToJSON,
  ServiceJobStatusToJSONTyped,
} from "./ServiceJobStatus";
import type { ServiceSpec } from "./ServiceSpec";
import {
  ServiceSpecFromJSON,
  ServiceSpecFromJSONTyped,
  ServiceSpecToJSON,
  ServiceSpecToJSONTyped,
} from "./ServiceSpec";
import type { ServiceUpdateStatus } from "./ServiceUpdateStatus";
import {
  ServiceUpdateStatusFromJSON,
  ServiceUpdateStatusFromJSONTyped,
  ServiceUpdateStatusToJSON,
  ServiceUpdateStatusToJSONTyped,
} from "./ServiceUpdateStatus";
import type { ServiceEndpoint } from "./ServiceEndpoint";
import {
  ServiceEndpointFromJSON,
  ServiceEndpointFromJSONTyped,
  ServiceEndpointToJSON,
  ServiceEndpointToJSONTyped,
} from "./ServiceEndpoint";

/**
 *
 * @export
 * @interface Service
 */
export interface Service {
  /**
   *
   * @type {string}
   * @memberof Service
   */
  ID?: string;
  /**
   *
   * @type {ObjectVersion}
   * @memberof Service
   */
  Version?: ObjectVersion;
  /**
   *
   * @type {string}
   * @memberof Service
   */
  CreatedAt?: string;
  /**
   *
   * @type {string}
   * @memberof Service
   */
  UpdatedAt?: string;
  /**
   *
   * @type {ServiceSpec}
   * @memberof Service
   */
  Spec?: ServiceSpec;
  /**
   *
   * @type {ServiceEndpoint}
   * @memberof Service
   */
  Endpoint?: ServiceEndpoint;
  /**
   *
   * @type {ServiceUpdateStatus}
   * @memberof Service
   */
  UpdateStatus?: ServiceUpdateStatus;
  /**
   *
   * @type {ServiceServiceStatus}
   * @memberof Service
   */
  ServiceStatus?: ServiceServiceStatus;
  /**
   *
   * @type {ServiceJobStatus}
   * @memberof Service
   */
  JobStatus?: ServiceJobStatus;
}

/**
 * Check if a given object implements the Service interface.
 */
export function instanceOfService(value: object): value is Service {
  return true;
}

export function ServiceFromJSON(json: any): Service {
  return ServiceFromJSONTyped(json, false);
}

export function ServiceFromJSONTyped(json: any, ignoreDiscriminator: boolean): Service {
  if (json == null) {
    return json;
  }
  return {
    ID: json["ID"] == null ? undefined : json["ID"],
    Version: json["Version"] == null ? undefined : ObjectVersionFromJSON(json["Version"]),
    CreatedAt: json["CreatedAt"] == null ? undefined : json["CreatedAt"],
    UpdatedAt: json["UpdatedAt"] == null ? undefined : json["UpdatedAt"],
    Spec: json["Spec"] == null ? undefined : ServiceSpecFromJSON(json["Spec"]),
    Endpoint: json["Endpoint"] == null ? undefined : ServiceEndpointFromJSON(json["Endpoint"]),
    UpdateStatus:
      json["UpdateStatus"] == null ? undefined : ServiceUpdateStatusFromJSON(json["UpdateStatus"]),
    ServiceStatus:
      json["ServiceStatus"] == null
        ? undefined
        : ServiceServiceStatusFromJSON(json["ServiceStatus"]),
    JobStatus: json["JobStatus"] == null ? undefined : ServiceJobStatusFromJSON(json["JobStatus"]),
  };
}

export function ServiceToJSON(json: any): Service {
  return ServiceToJSONTyped(json, false);
}

export function ServiceToJSONTyped(
  value?: Service | null,
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
    Spec: ServiceSpecToJSON(value["Spec"]),
    Endpoint: ServiceEndpointToJSON(value["Endpoint"]),
    UpdateStatus: ServiceUpdateStatusToJSON(value["UpdateStatus"]),
    ServiceStatus: ServiceServiceStatusToJSON(value["ServiceStatus"]),
    JobStatus: ServiceJobStatusToJSON(value["JobStatus"]),
  };
}
