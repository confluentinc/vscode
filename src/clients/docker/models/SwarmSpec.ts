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
import type { SwarmSpecDispatcher } from "./SwarmSpecDispatcher";
import {
  SwarmSpecDispatcherFromJSON,
  SwarmSpecDispatcherFromJSONTyped,
  SwarmSpecDispatcherToJSON,
  SwarmSpecDispatcherToJSONTyped,
} from "./SwarmSpecDispatcher";
import type { SwarmSpecOrchestration } from "./SwarmSpecOrchestration";
import {
  SwarmSpecOrchestrationFromJSON,
  SwarmSpecOrchestrationFromJSONTyped,
  SwarmSpecOrchestrationToJSON,
  SwarmSpecOrchestrationToJSONTyped,
} from "./SwarmSpecOrchestration";
import type { SwarmSpecCAConfig } from "./SwarmSpecCAConfig";
import {
  SwarmSpecCAConfigFromJSON,
  SwarmSpecCAConfigFromJSONTyped,
  SwarmSpecCAConfigToJSON,
  SwarmSpecCAConfigToJSONTyped,
} from "./SwarmSpecCAConfig";
import type { SwarmSpecTaskDefaults } from "./SwarmSpecTaskDefaults";
import {
  SwarmSpecTaskDefaultsFromJSON,
  SwarmSpecTaskDefaultsFromJSONTyped,
  SwarmSpecTaskDefaultsToJSON,
  SwarmSpecTaskDefaultsToJSONTyped,
} from "./SwarmSpecTaskDefaults";
import type { SwarmSpecRaft } from "./SwarmSpecRaft";
import {
  SwarmSpecRaftFromJSON,
  SwarmSpecRaftFromJSONTyped,
  SwarmSpecRaftToJSON,
  SwarmSpecRaftToJSONTyped,
} from "./SwarmSpecRaft";
import type { SwarmSpecEncryptionConfig } from "./SwarmSpecEncryptionConfig";
import {
  SwarmSpecEncryptionConfigFromJSON,
  SwarmSpecEncryptionConfigFromJSONTyped,
  SwarmSpecEncryptionConfigToJSON,
  SwarmSpecEncryptionConfigToJSONTyped,
} from "./SwarmSpecEncryptionConfig";

/**
 * User modifiable swarm configuration.
 * @export
 * @interface SwarmSpec
 */
export interface SwarmSpec {
  /**
   * Name of the swarm.
   * @type {string}
   * @memberof SwarmSpec
   */
  Name?: string;
  /**
   * User-defined key/value metadata.
   * @type {{ [key: string]: string; }}
   * @memberof SwarmSpec
   */
  Labels?: { [key: string]: string };
  /**
   *
   * @type {SwarmSpecOrchestration}
   * @memberof SwarmSpec
   */
  Orchestration?: SwarmSpecOrchestration | null;
  /**
   *
   * @type {SwarmSpecRaft}
   * @memberof SwarmSpec
   */
  Raft?: SwarmSpecRaft;
  /**
   *
   * @type {SwarmSpecDispatcher}
   * @memberof SwarmSpec
   */
  Dispatcher?: SwarmSpecDispatcher | null;
  /**
   *
   * @type {SwarmSpecCAConfig}
   * @memberof SwarmSpec
   */
  CAConfig?: SwarmSpecCAConfig | null;
  /**
   *
   * @type {SwarmSpecEncryptionConfig}
   * @memberof SwarmSpec
   */
  EncryptionConfig?: SwarmSpecEncryptionConfig;
  /**
   *
   * @type {SwarmSpecTaskDefaults}
   * @memberof SwarmSpec
   */
  TaskDefaults?: SwarmSpecTaskDefaults;
}

/**
 * Check if a given object implements the SwarmSpec interface.
 */
export function instanceOfSwarmSpec(value: object): value is SwarmSpec {
  return true;
}

export function SwarmSpecFromJSON(json: any): SwarmSpec {
  return SwarmSpecFromJSONTyped(json, false);
}

export function SwarmSpecFromJSONTyped(json: any, ignoreDiscriminator: boolean): SwarmSpec {
  if (json == null) {
    return json;
  }
  return {
    Name: json["Name"] == null ? undefined : json["Name"],
    Labels: json["Labels"] == null ? undefined : json["Labels"],
    Orchestration:
      json["Orchestration"] == null
        ? undefined
        : SwarmSpecOrchestrationFromJSON(json["Orchestration"]),
    Raft: json["Raft"] == null ? undefined : SwarmSpecRaftFromJSON(json["Raft"]),
    Dispatcher:
      json["Dispatcher"] == null ? undefined : SwarmSpecDispatcherFromJSON(json["Dispatcher"]),
    CAConfig: json["CAConfig"] == null ? undefined : SwarmSpecCAConfigFromJSON(json["CAConfig"]),
    EncryptionConfig:
      json["EncryptionConfig"] == null
        ? undefined
        : SwarmSpecEncryptionConfigFromJSON(json["EncryptionConfig"]),
    TaskDefaults:
      json["TaskDefaults"] == null
        ? undefined
        : SwarmSpecTaskDefaultsFromJSON(json["TaskDefaults"]),
  };
}

export function SwarmSpecToJSON(json: any): SwarmSpec {
  return SwarmSpecToJSONTyped(json, false);
}

export function SwarmSpecToJSONTyped(
  value?: SwarmSpec | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    Name: value["Name"],
    Labels: value["Labels"],
    Orchestration: SwarmSpecOrchestrationToJSON(value["Orchestration"]),
    Raft: SwarmSpecRaftToJSON(value["Raft"]),
    Dispatcher: SwarmSpecDispatcherToJSON(value["Dispatcher"]),
    CAConfig: SwarmSpecCAConfigToJSON(value["CAConfig"]),
    EncryptionConfig: SwarmSpecEncryptionConfigToJSON(value["EncryptionConfig"]),
    TaskDefaults: SwarmSpecTaskDefaultsToJSON(value["TaskDefaults"]),
  };
}
