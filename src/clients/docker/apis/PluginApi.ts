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


import * as runtime from '../runtime';
import type {
  ErrorResponse,
  Plugin,
  PluginPrivilege,
} from '../models/index';
import {
    ErrorResponseFromJSON,
    ErrorResponseToJSON,
    PluginFromJSON,
    PluginToJSON,
    PluginPrivilegeFromJSON,
    PluginPrivilegeToJSON,
} from '../models/index';

export interface GetPluginPrivilegesRequest {
    remote: string;
}

export interface PluginCreateRequest {
    name: string;
    tarContext?: Blob;
}

export interface PluginDeleteRequest {
    name: string;
    force?: boolean;
}

export interface PluginDisableRequest {
    name: string;
    force?: boolean;
}

export interface PluginEnableRequest {
    name: string;
    timeout?: number;
}

export interface PluginInspectRequest {
    name: string;
}

export interface PluginListRequest {
    filters?: string;
}

export interface PluginPullRequest {
    remote: string;
    name?: string;
    X_Registry_Auth?: string;
    body?: Array<PluginPrivilege>;
}

export interface PluginPushRequest {
    name: string;
}

export interface PluginSetRequest {
    name: string;
    body?: Array<string>;
}

export interface PluginUpgradeRequest {
    name: string;
    remote: string;
    X_Registry_Auth?: string;
    body?: Array<PluginPrivilege>;
}

/**
 * 
 */
export class PluginApi extends runtime.BaseAPI {

    /**
     * Get plugin privileges
     */
    async getPluginPrivilegesRaw(requestParameters: GetPluginPrivilegesRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<Array<PluginPrivilege>>> {
        if (requestParameters['remote'] == null) {
            throw new runtime.RequiredError(
                'remote',
                'Required parameter "remote" was null or undefined when calling getPluginPrivileges().'
            );
        }

        const queryParameters: any = {};

        if (requestParameters['remote'] != null) {
            queryParameters['remote'] = requestParameters['remote'];
        }

        const headerParameters: runtime.HTTPHeaders = {};

        const response = await this.request({
            path: `/plugins/privileges`,
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        }, initOverrides);

        return new runtime.JSONApiResponse(response, (jsonValue) => jsonValue.map(PluginPrivilegeFromJSON));
    }

    /**
     * Get plugin privileges
     */
    async getPluginPrivileges(requestParameters: GetPluginPrivilegesRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<Array<PluginPrivilege>> {
        const response = await this.getPluginPrivilegesRaw(requestParameters, initOverrides);
        return await response.value();
    }

    /**
     * Create a plugin
     */
    async pluginCreateRaw(requestParameters: PluginCreateRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<void>> {
        if (requestParameters['name'] == null) {
            throw new runtime.RequiredError(
                'name',
                'Required parameter "name" was null or undefined when calling pluginCreate().'
            );
        }

        const queryParameters: any = {};

        if (requestParameters['name'] != null) {
            queryParameters['name'] = requestParameters['name'];
        }

        const headerParameters: runtime.HTTPHeaders = {};

        headerParameters['Content-Type'] = 'application/x-tar';

        const response = await this.request({
            path: `/plugins/create`,
            method: 'POST',
            headers: headerParameters,
            query: queryParameters,
            body: requestParameters['tarContext'] as any,
        }, initOverrides);

        return new runtime.VoidApiResponse(response);
    }

    /**
     * Create a plugin
     */
    async pluginCreate(requestParameters: PluginCreateRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<void> {
        await this.pluginCreateRaw(requestParameters, initOverrides);
    }

    /**
     * Remove a plugin
     */
    async pluginDeleteRaw(requestParameters: PluginDeleteRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<Plugin>> {
        if (requestParameters['name'] == null) {
            throw new runtime.RequiredError(
                'name',
                'Required parameter "name" was null or undefined when calling pluginDelete().'
            );
        }

        const queryParameters: any = {};

        if (requestParameters['force'] != null) {
            queryParameters['force'] = requestParameters['force'];
        }

        const headerParameters: runtime.HTTPHeaders = {};

        const response = await this.request({
            path: `/plugins/{name}`.replace(`{${"name"}}`, encodeURIComponent(String(requestParameters['name']))),
            method: 'DELETE',
            headers: headerParameters,
            query: queryParameters,
        }, initOverrides);

        return new runtime.JSONApiResponse(response, (jsonValue) => PluginFromJSON(jsonValue));
    }

    /**
     * Remove a plugin
     */
    async pluginDelete(requestParameters: PluginDeleteRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<Plugin> {
        const response = await this.pluginDeleteRaw(requestParameters, initOverrides);
        return await response.value();
    }

    /**
     * Disable a plugin
     */
    async pluginDisableRaw(requestParameters: PluginDisableRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<void>> {
        if (requestParameters['name'] == null) {
            throw new runtime.RequiredError(
                'name',
                'Required parameter "name" was null or undefined when calling pluginDisable().'
            );
        }

        const queryParameters: any = {};

        if (requestParameters['force'] != null) {
            queryParameters['force'] = requestParameters['force'];
        }

        const headerParameters: runtime.HTTPHeaders = {};

        const response = await this.request({
            path: `/plugins/{name}/disable`.replace(`{${"name"}}`, encodeURIComponent(String(requestParameters['name']))),
            method: 'POST',
            headers: headerParameters,
            query: queryParameters,
        }, initOverrides);

        return new runtime.VoidApiResponse(response);
    }

    /**
     * Disable a plugin
     */
    async pluginDisable(requestParameters: PluginDisableRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<void> {
        await this.pluginDisableRaw(requestParameters, initOverrides);
    }

    /**
     * Enable a plugin
     */
    async pluginEnableRaw(requestParameters: PluginEnableRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<void>> {
        if (requestParameters['name'] == null) {
            throw new runtime.RequiredError(
                'name',
                'Required parameter "name" was null or undefined when calling pluginEnable().'
            );
        }

        const queryParameters: any = {};

        if (requestParameters['timeout'] != null) {
            queryParameters['timeout'] = requestParameters['timeout'];
        }

        const headerParameters: runtime.HTTPHeaders = {};

        const response = await this.request({
            path: `/plugins/{name}/enable`.replace(`{${"name"}}`, encodeURIComponent(String(requestParameters['name']))),
            method: 'POST',
            headers: headerParameters,
            query: queryParameters,
        }, initOverrides);

        return new runtime.VoidApiResponse(response);
    }

    /**
     * Enable a plugin
     */
    async pluginEnable(requestParameters: PluginEnableRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<void> {
        await this.pluginEnableRaw(requestParameters, initOverrides);
    }

    /**
     * Inspect a plugin
     */
    async pluginInspectRaw(requestParameters: PluginInspectRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<Plugin>> {
        if (requestParameters['name'] == null) {
            throw new runtime.RequiredError(
                'name',
                'Required parameter "name" was null or undefined when calling pluginInspect().'
            );
        }

        const queryParameters: any = {};

        const headerParameters: runtime.HTTPHeaders = {};

        const response = await this.request({
            path: `/plugins/{name}/json`.replace(`{${"name"}}`, encodeURIComponent(String(requestParameters['name']))),
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        }, initOverrides);

        return new runtime.JSONApiResponse(response, (jsonValue) => PluginFromJSON(jsonValue));
    }

    /**
     * Inspect a plugin
     */
    async pluginInspect(requestParameters: PluginInspectRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<Plugin> {
        const response = await this.pluginInspectRaw(requestParameters, initOverrides);
        return await response.value();
    }

    /**
     * Returns information about installed plugins.
     * List plugins
     */
    async pluginListRaw(requestParameters: PluginListRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<Array<Plugin>>> {
        const queryParameters: any = {};

        if (requestParameters['filters'] != null) {
            queryParameters['filters'] = requestParameters['filters'];
        }

        const headerParameters: runtime.HTTPHeaders = {};

        const response = await this.request({
            path: `/plugins`,
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        }, initOverrides);

        return new runtime.JSONApiResponse(response, (jsonValue) => jsonValue.map(PluginFromJSON));
    }

    /**
     * Returns information about installed plugins.
     * List plugins
     */
    async pluginList(requestParameters: PluginListRequest = {}, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<Array<Plugin>> {
        const response = await this.pluginListRaw(requestParameters, initOverrides);
        return await response.value();
    }

    /**
     * Pulls and installs a plugin. After the plugin is installed, it can be enabled using the [`POST /plugins/{name}/enable` endpoint](#operation/PostPluginsEnable). 
     * Install a plugin
     */
    async pluginPullRaw(requestParameters: PluginPullRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<void>> {
        if (requestParameters['remote'] == null) {
            throw new runtime.RequiredError(
                'remote',
                'Required parameter "remote" was null or undefined when calling pluginPull().'
            );
        }

        const queryParameters: any = {};

        if (requestParameters['remote'] != null) {
            queryParameters['remote'] = requestParameters['remote'];
        }

        if (requestParameters['name'] != null) {
            queryParameters['name'] = requestParameters['name'];
        }

        const headerParameters: runtime.HTTPHeaders = {};

        headerParameters['Content-Type'] = 'application/json';

        if (requestParameters['X_Registry_Auth'] != null) {
            headerParameters['X-Registry-Auth'] = String(requestParameters['X_Registry_Auth']);
        }

        const response = await this.request({
            path: `/plugins/pull`,
            method: 'POST',
            headers: headerParameters,
            query: queryParameters,
            body: requestParameters['body']!.map(PluginPrivilegeToJSON),
        }, initOverrides);

        return new runtime.VoidApiResponse(response);
    }

    /**
     * Pulls and installs a plugin. After the plugin is installed, it can be enabled using the [`POST /plugins/{name}/enable` endpoint](#operation/PostPluginsEnable). 
     * Install a plugin
     */
    async pluginPull(requestParameters: PluginPullRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<void> {
        await this.pluginPullRaw(requestParameters, initOverrides);
    }

    /**
     * Push a plugin to the registry. 
     * Push a plugin
     */
    async pluginPushRaw(requestParameters: PluginPushRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<void>> {
        if (requestParameters['name'] == null) {
            throw new runtime.RequiredError(
                'name',
                'Required parameter "name" was null or undefined when calling pluginPush().'
            );
        }

        const queryParameters: any = {};

        const headerParameters: runtime.HTTPHeaders = {};

        const response = await this.request({
            path: `/plugins/{name}/push`.replace(`{${"name"}}`, encodeURIComponent(String(requestParameters['name']))),
            method: 'POST',
            headers: headerParameters,
            query: queryParameters,
        }, initOverrides);

        return new runtime.VoidApiResponse(response);
    }

    /**
     * Push a plugin to the registry. 
     * Push a plugin
     */
    async pluginPush(requestParameters: PluginPushRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<void> {
        await this.pluginPushRaw(requestParameters, initOverrides);
    }

    /**
     * Configure a plugin
     */
    async pluginSetRaw(requestParameters: PluginSetRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<void>> {
        if (requestParameters['name'] == null) {
            throw new runtime.RequiredError(
                'name',
                'Required parameter "name" was null or undefined when calling pluginSet().'
            );
        }

        const queryParameters: any = {};

        const headerParameters: runtime.HTTPHeaders = {};

        headerParameters['Content-Type'] = 'application/json';

        const response = await this.request({
            path: `/plugins/{name}/set`.replace(`{${"name"}}`, encodeURIComponent(String(requestParameters['name']))),
            method: 'POST',
            headers: headerParameters,
            query: queryParameters,
            body: requestParameters['body'],
        }, initOverrides);

        return new runtime.VoidApiResponse(response);
    }

    /**
     * Configure a plugin
     */
    async pluginSet(requestParameters: PluginSetRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<void> {
        await this.pluginSetRaw(requestParameters, initOverrides);
    }

    /**
     * Upgrade a plugin
     */
    async pluginUpgradeRaw(requestParameters: PluginUpgradeRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<void>> {
        if (requestParameters['name'] == null) {
            throw new runtime.RequiredError(
                'name',
                'Required parameter "name" was null or undefined when calling pluginUpgrade().'
            );
        }

        if (requestParameters['remote'] == null) {
            throw new runtime.RequiredError(
                'remote',
                'Required parameter "remote" was null or undefined when calling pluginUpgrade().'
            );
        }

        const queryParameters: any = {};

        if (requestParameters['remote'] != null) {
            queryParameters['remote'] = requestParameters['remote'];
        }

        const headerParameters: runtime.HTTPHeaders = {};

        headerParameters['Content-Type'] = 'application/json';

        if (requestParameters['X_Registry_Auth'] != null) {
            headerParameters['X-Registry-Auth'] = String(requestParameters['X_Registry_Auth']);
        }

        const response = await this.request({
            path: `/plugins/{name}/upgrade`.replace(`{${"name"}}`, encodeURIComponent(String(requestParameters['name']))),
            method: 'POST',
            headers: headerParameters,
            query: queryParameters,
            body: requestParameters['body']!.map(PluginPrivilegeToJSON),
        }, initOverrides);

        return new runtime.VoidApiResponse(response);
    }

    /**
     * Upgrade a plugin
     */
    async pluginUpgrade(requestParameters: PluginUpgradeRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<void> {
        await this.pluginUpgradeRaw(requestParameters, initOverrides);
    }

}
