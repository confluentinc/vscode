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
 * 
 * @export
 * @interface SystemVersionComponentsInner
 */
export interface SystemVersionComponentsInner {
    /**
     * Name of the component
     * 
     * @type {string}
     * @memberof SystemVersionComponentsInner
     */
    Name: string;
    /**
     * Version of the component
     * 
     * @type {string}
     * @memberof SystemVersionComponentsInner
     */
    Version: string;
    /**
     * Key/value pairs of strings with additional information about the
     * component. These values are intended for informational purposes
     * only, and their content is not defined, and not part of the API
     * specification.
     * 
     * These messages can be printed by the client as information to the user.
     * 
     * @type {object}
     * @memberof SystemVersionComponentsInner
     */
    Details?: object | null;
}

/**
 * Check if a given object implements the SystemVersionComponentsInner interface.
 */
export function instanceOfSystemVersionComponentsInner(value: object): value is SystemVersionComponentsInner {
    if (!('Name' in value) || value['Name'] === undefined) return false;
    if (!('Version' in value) || value['Version'] === undefined) return false;
    return true;
}

export function SystemVersionComponentsInnerFromJSON(json: any): SystemVersionComponentsInner {
    return SystemVersionComponentsInnerFromJSONTyped(json, false);
}

export function SystemVersionComponentsInnerFromJSONTyped(json: any, ignoreDiscriminator: boolean): SystemVersionComponentsInner {
    if (json == null) {
        return json;
    }
    return {
        
        'Name': json['Name'],
        'Version': json['Version'],
        'Details': json['Details'] == null ? undefined : json['Details'],
    };
}

export function SystemVersionComponentsInnerToJSON(value?: SystemVersionComponentsInner | null): any {
    if (value == null) {
        return value;
    }
    return {
        
        'Name': value['Name'],
        'Version': value['Version'],
        'Details': value['Details'],
    };
}

