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
 * IndexInfo contains information about a registry.
 * @export
 * @interface IndexInfo
 */
export interface IndexInfo {
    /**
     * Name of the registry, such as "docker.io".
     * 
     * @type {string}
     * @memberof IndexInfo
     */
    Name?: string;
    /**
     * List of mirrors, expressed as URIs.
     * 
     * @type {Array<string>}
     * @memberof IndexInfo
     */
    Mirrors?: Array<string>;
    /**
     * Indicates if the registry is part of the list of insecure
     * registries.
     * 
     * If `false`, the registry is insecure. Insecure registries accept
     * un-encrypted (HTTP) and/or untrusted (HTTPS with certificates from
     * unknown CAs) communication.
     * 
     * > **Warning**: Insecure registries can be useful when running a local
     * > registry. However, because its use creates security vulnerabilities
     * > it should ONLY be enabled for testing purposes. For increased
     * > security, users should add their CA to their system's list of
     * > trusted CAs instead of enabling this option.
     * 
     * @type {boolean}
     * @memberof IndexInfo
     */
    Secure?: boolean;
    /**
     * Indicates whether this is an official registry (i.e., Docker Hub / docker.io)
     * 
     * @type {boolean}
     * @memberof IndexInfo
     */
    Official?: boolean;
}

/**
 * Check if a given object implements the IndexInfo interface.
 */
export function instanceOfIndexInfo(value: object): value is IndexInfo {
    return true;
}

export function IndexInfoFromJSON(json: any): IndexInfo {
    return IndexInfoFromJSONTyped(json, false);
}

export function IndexInfoFromJSONTyped(json: any, ignoreDiscriminator: boolean): IndexInfo {
    if (json == null) {
        return json;
    }
    return {
        
        'Name': json['Name'] == null ? undefined : json['Name'],
        'Mirrors': json['Mirrors'] == null ? undefined : json['Mirrors'],
        'Secure': json['Secure'] == null ? undefined : json['Secure'],
        'Official': json['Official'] == null ? undefined : json['Official'],
    };
}

export function IndexInfoToJSON(value?: IndexInfo | null): any {
    if (value == null) {
        return value;
    }
    return {
        
        'Name': value['Name'],
        'Mirrors': value['Mirrors'],
        'Secure': value['Secure'],
        'Official': value['Official'],
    };
}

