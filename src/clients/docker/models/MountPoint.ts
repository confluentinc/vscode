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
 * MountPoint represents a mount point configuration inside the container.
 * This is used for reporting the mountpoints in use by a container.
 *
 * @export
 * @interface MountPoint
 */
export interface MountPoint {
  /**
   * The mount type:
   *
   * - `bind` a mount of a file or directory from the host into the container.
   * - `volume` a docker volume with the given `Name`.
   * - `tmpfs` a `tmpfs`.
   * - `npipe` a named pipe from the host into the container.
   * - `cluster` a Swarm cluster volume
   *
   * @type {string}
   * @memberof MountPoint
   */
  Type?: MountPointTypeEnum;
  /**
   * Name is the name reference to the underlying data defined by `Source`
   * e.g., the volume name.
   *
   * @type {string}
   * @memberof MountPoint
   */
  Name?: string;
  /**
   * Source location of the mount.
   *
   * For volumes, this contains the storage location of the volume (within
   * `/var/lib/docker/volumes/`). For bind-mounts, and `npipe`, this contains
   * the source (host) part of the bind-mount. For `tmpfs` mount points, this
   * field is empty.
   *
   * @type {string}
   * @memberof MountPoint
   */
  Source?: string;
  /**
   * Destination is the path relative to the container root (`/`) where
   * the `Source` is mounted inside the container.
   *
   * @type {string}
   * @memberof MountPoint
   */
  Destination?: string;
  /**
   * Driver is the volume driver used to create the volume (if it is a volume).
   *
   * @type {string}
   * @memberof MountPoint
   */
  Driver?: string;
  /**
   * Mode is a comma separated list of options supplied by the user when
   * creating the bind/volume mount.
   *
   * The default is platform-specific (`"z"` on Linux, empty on Windows).
   *
   * @type {string}
   * @memberof MountPoint
   */
  Mode?: string;
  /**
   * Whether the mount is mounted writable (read-write).
   *
   * @type {boolean}
   * @memberof MountPoint
   */
  RW?: boolean;
  /**
   * Propagation describes how mounts are propagated from the host into the
   * mount point, and vice-versa. Refer to the [Linux kernel documentation](https://www.kernel.org/doc/Documentation/filesystems/sharedsubtree.txt)
   * for details. This field is not used on Windows.
   *
   * @type {string}
   * @memberof MountPoint
   */
  Propagation?: string;
}

/**
 * @export
 * @enum {string}
 */
export enum MountPointTypeEnum {
  Bind = "bind",
  Volume = "volume",
  Tmpfs = "tmpfs",
  Npipe = "npipe",
  Cluster = "cluster",
}

/**
 * Check if a given object implements the MountPoint interface.
 */
export function instanceOfMountPoint(value: object): value is MountPoint {
  return true;
}

export function MountPointFromJSON(json: any): MountPoint {
  return MountPointFromJSONTyped(json, false);
}

export function MountPointFromJSONTyped(json: any, ignoreDiscriminator: boolean): MountPoint {
  if (json == null) {
    return json;
  }
  return {
    Type: json["Type"] == null ? undefined : json["Type"],
    Name: json["Name"] == null ? undefined : json["Name"],
    Source: json["Source"] == null ? undefined : json["Source"],
    Destination: json["Destination"] == null ? undefined : json["Destination"],
    Driver: json["Driver"] == null ? undefined : json["Driver"],
    Mode: json["Mode"] == null ? undefined : json["Mode"],
    RW: json["RW"] == null ? undefined : json["RW"],
    Propagation: json["Propagation"] == null ? undefined : json["Propagation"],
  };
}

export function MountPointToJSON(json: any): MountPoint {
  return MountPointToJSONTyped(json, false);
}

export function MountPointToJSONTyped(
  value?: MountPoint | null,
  ignoreDiscriminator: boolean = false,
): any {
  if (value == null) {
    return value;
  }

  return {
    Type: value["Type"],
    Name: value["Name"],
    Source: value["Source"],
    Destination: value["Destination"],
    Driver: value["Driver"],
    Mode: value["Mode"],
    RW: value["RW"],
    Propagation: value["Propagation"],
  };
}
