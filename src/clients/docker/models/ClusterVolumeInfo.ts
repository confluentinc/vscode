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

import { mapValues } from '../runtime';
/**
 * Information about the global status of the volume.
 * 
 * @export
 * @interface ClusterVolumeInfo
 */
export interface ClusterVolumeInfo {
    /**
     * The capacity of the volume in bytes. A value of 0 indicates that
     * the capacity is unknown.
     * 
     * @type {number}
     * @memberof ClusterVolumeInfo
     */
    CapacityBytes?: number;
    /**
     * A map of strings to strings returned from the storage plugin when
     * the volume is created.
     * 
     * @type {{ [key: string]: string; }}
     * @memberof ClusterVolumeInfo
     */
    VolumeContext?: { [key: string]: string; };
    /**
     * The ID of the volume as returned by the CSI storage plugin. This
     * is distinct from the volume's ID as provided by Docker. This ID
     * is never used by the user when communicating with Docker to refer
     * to this volume. If the ID is blank, then the Volume has not been
     * successfully created in the plugin yet.
     * 
     * @type {string}
     * @memberof ClusterVolumeInfo
     */
    VolumeID?: string;
    /**
     * The topology this volume is actually accessible from.
     * 
     * @type {Array<{ [key: string]: string; }>}
     * @memberof ClusterVolumeInfo
     */
    AccessibleTopology?: Array<{ [key: string]: string; }>;
}

/**
 * Check if a given object implements the ClusterVolumeInfo interface.
 */
export function instanceOfClusterVolumeInfo(value: object): value is ClusterVolumeInfo {
    return true;
}

export function ClusterVolumeInfoFromJSON(json: any): ClusterVolumeInfo {
    return ClusterVolumeInfoFromJSONTyped(json, false);
}

export function ClusterVolumeInfoFromJSONTyped(json: any, ignoreDiscriminator: boolean): ClusterVolumeInfo {
    if (json == null) {
        return json;
    }
    return {
        
        'CapacityBytes': json['CapacityBytes'] == null ? undefined : json['CapacityBytes'],
        'VolumeContext': json['VolumeContext'] == null ? undefined : json['VolumeContext'],
        'VolumeID': json['VolumeID'] == null ? undefined : json['VolumeID'],
        'AccessibleTopology': json['AccessibleTopology'] == null ? undefined : json['AccessibleTopology'],
    };
}

export function ClusterVolumeInfoToJSON(value?: ClusterVolumeInfo | null): any {
    if (value == null) {
        return value;
    }
    return {
        
        'CapacityBytes': value['CapacityBytes'],
        'VolumeContext': value['VolumeContext'],
        'VolumeID': value['VolumeID'],
        'AccessibleTopology': value['AccessibleTopology'],
    };
}

