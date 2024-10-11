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
import type { PluginEnv } from "./PluginEnv";
import { PluginEnvFromJSON, PluginEnvFromJSONTyped, PluginEnvToJSON } from "./PluginEnv";
import type { PluginConfigLinux } from "./PluginConfigLinux";
import {
  PluginConfigLinuxFromJSON,
  PluginConfigLinuxFromJSONTyped,
  PluginConfigLinuxToJSON,
} from "./PluginConfigLinux";
import type { PluginConfigArgs } from "./PluginConfigArgs";
import {
  PluginConfigArgsFromJSON,
  PluginConfigArgsFromJSONTyped,
  PluginConfigArgsToJSON,
} from "./PluginConfigArgs";
import type { PluginConfigRootfs } from "./PluginConfigRootfs";
import {
  PluginConfigRootfsFromJSON,
  PluginConfigRootfsFromJSONTyped,
  PluginConfigRootfsToJSON,
} from "./PluginConfigRootfs";
import type { PluginConfigNetwork } from "./PluginConfigNetwork";
import {
  PluginConfigNetworkFromJSON,
  PluginConfigNetworkFromJSONTyped,
  PluginConfigNetworkToJSON,
} from "./PluginConfigNetwork";
import type { PluginConfigInterface } from "./PluginConfigInterface";
import {
  PluginConfigInterfaceFromJSON,
  PluginConfigInterfaceFromJSONTyped,
  PluginConfigInterfaceToJSON,
} from "./PluginConfigInterface";
import type { PluginConfigUser } from "./PluginConfigUser";
import {
  PluginConfigUserFromJSON,
  PluginConfigUserFromJSONTyped,
  PluginConfigUserToJSON,
} from "./PluginConfigUser";
import type { PluginMount } from "./PluginMount";
import { PluginMountFromJSON, PluginMountFromJSONTyped, PluginMountToJSON } from "./PluginMount";

/**
 * The config of a plugin.
 * @export
 * @interface PluginConfig
 */
export interface PluginConfig {
  /**
   * Docker Version used to create the plugin
   * @type {string}
   * @memberof PluginConfig
   */
  DockerVersion?: string;
  /**
   *
   * @type {string}
   * @memberof PluginConfig
   */
  Description: string;
  /**
   *
   * @type {string}
   * @memberof PluginConfig
   */
  Documentation: string;
  /**
   *
   * @type {PluginConfigInterface}
   * @memberof PluginConfig
   */
  Interface: PluginConfigInterface;
  /**
   *
   * @type {Array<string>}
   * @memberof PluginConfig
   */
  Entrypoint: Array<string>;
  /**
   *
   * @type {string}
   * @memberof PluginConfig
   */
  WorkDir: string;
  /**
   *
   * @type {PluginConfigUser}
   * @memberof PluginConfig
   */
  User?: PluginConfigUser;
  /**
   *
   * @type {PluginConfigNetwork}
   * @memberof PluginConfig
   */
  Network: PluginConfigNetwork;
  /**
   *
   * @type {PluginConfigLinux}
   * @memberof PluginConfig
   */
  Linux: PluginConfigLinux;
  /**
   *
   * @type {string}
   * @memberof PluginConfig
   */
  PropagatedMount: string;
  /**
   *
   * @type {boolean}
   * @memberof PluginConfig
   */
  IpcHost: boolean;
  /**
   *
   * @type {boolean}
   * @memberof PluginConfig
   */
  PidHost: boolean;
  /**
   *
   * @type {Array<PluginMount>}
   * @memberof PluginConfig
   */
  Mounts: Array<PluginMount>;
  /**
   *
   * @type {Array<PluginEnv>}
   * @memberof PluginConfig
   */
  Env: Array<PluginEnv>;
  /**
   *
   * @type {PluginConfigArgs}
   * @memberof PluginConfig
   */
  Args: PluginConfigArgs;
  /**
   *
   * @type {PluginConfigRootfs}
   * @memberof PluginConfig
   */
  rootfs?: PluginConfigRootfs;
}

/**
 * Check if a given object implements the PluginConfig interface.
 */
export function instanceOfPluginConfig(value: object): value is PluginConfig {
  if (!("Description" in value) || value["Description"] === undefined) return false;
  if (!("Documentation" in value) || value["Documentation"] === undefined) return false;
  if (!("Interface" in value) || value["Interface"] === undefined) return false;
  if (!("Entrypoint" in value) || value["Entrypoint"] === undefined) return false;
  if (!("WorkDir" in value) || value["WorkDir"] === undefined) return false;
  if (!("Network" in value) || value["Network"] === undefined) return false;
  if (!("Linux" in value) || value["Linux"] === undefined) return false;
  if (!("PropagatedMount" in value) || value["PropagatedMount"] === undefined) return false;
  if (!("IpcHost" in value) || value["IpcHost"] === undefined) return false;
  if (!("PidHost" in value) || value["PidHost"] === undefined) return false;
  if (!("Mounts" in value) || value["Mounts"] === undefined) return false;
  if (!("Env" in value) || value["Env"] === undefined) return false;
  if (!("Args" in value) || value["Args"] === undefined) return false;
  return true;
}

export function PluginConfigFromJSON(json: any): PluginConfig {
  return PluginConfigFromJSONTyped(json, false);
}

export function PluginConfigFromJSONTyped(json: any, ignoreDiscriminator: boolean): PluginConfig {
  if (json == null) {
    return json;
  }
  return {
    DockerVersion: json["DockerVersion"] == null ? undefined : json["DockerVersion"],
    Description: json["Description"],
    Documentation: json["Documentation"],
    Interface: PluginConfigInterfaceFromJSON(json["Interface"]),
    Entrypoint: json["Entrypoint"],
    WorkDir: json["WorkDir"],
    User: json["User"] == null ? undefined : PluginConfigUserFromJSON(json["User"]),
    Network: PluginConfigNetworkFromJSON(json["Network"]),
    Linux: PluginConfigLinuxFromJSON(json["Linux"]),
    PropagatedMount: json["PropagatedMount"],
    IpcHost: json["IpcHost"],
    PidHost: json["PidHost"],
    Mounts: (json["Mounts"] as Array<any>).map(PluginMountFromJSON),
    Env: (json["Env"] as Array<any>).map(PluginEnvFromJSON),
    Args: PluginConfigArgsFromJSON(json["Args"]),
    rootfs: json["rootfs"] == null ? undefined : PluginConfigRootfsFromJSON(json["rootfs"]),
  };
}

export function PluginConfigToJSON(value?: PluginConfig | null): any {
  if (value == null) {
    return value;
  }
  return {
    DockerVersion: value["DockerVersion"],
    Description: value["Description"],
    Documentation: value["Documentation"],
    Interface: PluginConfigInterfaceToJSON(value["Interface"]),
    Entrypoint: value["Entrypoint"],
    WorkDir: value["WorkDir"],
    User: PluginConfigUserToJSON(value["User"]),
    Network: PluginConfigNetworkToJSON(value["Network"]),
    Linux: PluginConfigLinuxToJSON(value["Linux"]),
    PropagatedMount: value["PropagatedMount"],
    IpcHost: value["IpcHost"],
    PidHost: value["PidHost"],
    Mounts: (value["Mounts"] as Array<any>).map(PluginMountToJSON),
    Env: (value["Env"] as Array<any>).map(PluginEnvToJSON),
    Args: PluginConfigArgsToJSON(value["Args"]),
    rootfs: PluginConfigRootfsToJSON(value["rootfs"]),
  };
}
