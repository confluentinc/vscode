/* tslint:disable */
/* eslint-disable */
/**
 * Confluent Schema Registry APIs
 * REST API for the Schema Registry
 *
 * The version of the OpenAPI document: 1.0.0
 * 
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */


import * as runtime from '../runtime';
import type {
  ErrorMessage,
  ExporterConfigResponse,
  ExporterReference,
  ExporterResponse,
  ExporterStatusResponse,
  ExporterUpdateRequest,
} from '../models/index';
import {
    ErrorMessageFromJSON,
    ErrorMessageToJSON,
    ExporterConfigResponseFromJSON,
    ExporterConfigResponseToJSON,
    ExporterReferenceFromJSON,
    ExporterReferenceToJSON,
    ExporterResponseFromJSON,
    ExporterResponseToJSON,
    ExporterStatusResponseFromJSON,
    ExporterStatusResponseToJSON,
    ExporterUpdateRequestFromJSON,
    ExporterUpdateRequestToJSON,
} from '../models/index';

export interface DeleteExporterRequest {
    name: string;
}

export interface GetExporterConfigByNameRequest {
    name: string;
}

export interface GetExporterInfoByNameRequest {
    name: string;
}

export interface GetExporterStatusByNameRequest {
    name: string;
}

export interface PauseExporterByNameRequest {
    name: string;
}

export interface RegisterExporterRequest {
    ExporterReference: ExporterReference;
}

export interface ResetExporterByNameRequest {
    name: string;
}

export interface ResumeExporterByNameRequest {
    name: string;
}

export interface UpdateExporterConfigByNameRequest {
    name: string;
    ExporterConfigResponse: ExporterConfigResponse;
}

export interface UpdateExporterInfoRequest {
    name: string;
    ExporterUpdateRequest: ExporterUpdateRequest;
}

/**
 * 
 */
export class ExportersV1Api extends runtime.BaseAPI {

    /**
     * Deletes the schema exporter.
     * Delete schema exporter by name
     */
    async deleteExporterRaw(requestParameters: DeleteExporterRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<void>> {
        if (requestParameters['name'] == null) {
            throw new runtime.RequiredError(
                'name',
                'Required parameter "name" was null or undefined when calling deleteExporter().'
            );
        }

        const queryParameters: any = {};

        const headerParameters: runtime.HTTPHeaders = {};

        if (this.configuration && this.configuration.accessToken) {
            // oauth required
            headerParameters["Authorization"] = await this.configuration.accessToken("external-access-token", []);
        }

        if (this.configuration && (this.configuration.username !== undefined || this.configuration.password !== undefined)) {
            headerParameters["Authorization"] = "Basic " + btoa(this.configuration.username + ":" + this.configuration.password);
        }
        const response = await this.request({
            path: `/exporters/{name}`.replace(`{${"name"}}`, encodeURIComponent(String(requestParameters['name']))),
            method: 'DELETE',
            headers: headerParameters,
            query: queryParameters,
        }, initOverrides);

        return new runtime.VoidApiResponse(response);
    }

    /**
     * Deletes the schema exporter.
     * Delete schema exporter by name
     */
    async deleteExporter(requestParameters: DeleteExporterRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<void> {
        await this.deleteExporterRaw(requestParameters, initOverrides);
    }

    /**
     * Retrieves the config of the schema exporter.
     * Gets schema exporter config by name
     */
    async getExporterConfigByNameRaw(requestParameters: GetExporterConfigByNameRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<ExporterConfigResponse>> {
        if (requestParameters['name'] == null) {
            throw new runtime.RequiredError(
                'name',
                'Required parameter "name" was null or undefined when calling getExporterConfigByName().'
            );
        }

        const queryParameters: any = {};

        const headerParameters: runtime.HTTPHeaders = {};

        if (this.configuration && this.configuration.accessToken) {
            // oauth required
            headerParameters["Authorization"] = await this.configuration.accessToken("external-access-token", []);
        }

        if (this.configuration && (this.configuration.username !== undefined || this.configuration.password !== undefined)) {
            headerParameters["Authorization"] = "Basic " + btoa(this.configuration.username + ":" + this.configuration.password);
        }
        const response = await this.request({
            path: `/exporters/{name}/config`.replace(`{${"name"}}`, encodeURIComponent(String(requestParameters['name']))),
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        }, initOverrides);

        return new runtime.JSONApiResponse(response, (jsonValue) => ExporterConfigResponseFromJSON(jsonValue));
    }

    /**
     * Retrieves the config of the schema exporter.
     * Gets schema exporter config by name
     */
    async getExporterConfigByName(requestParameters: GetExporterConfigByNameRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<ExporterConfigResponse> {
        const response = await this.getExporterConfigByNameRaw(requestParameters, initOverrides);
        return await response.value();
    }

    /**
     * Retrieves the information of the schema exporter.
     * Gets schema exporter by name
     */
    async getExporterInfoByNameRaw(requestParameters: GetExporterInfoByNameRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<ExporterReference>> {
        if (requestParameters['name'] == null) {
            throw new runtime.RequiredError(
                'name',
                'Required parameter "name" was null or undefined when calling getExporterInfoByName().'
            );
        }

        const queryParameters: any = {};

        const headerParameters: runtime.HTTPHeaders = {};

        if (this.configuration && this.configuration.accessToken) {
            // oauth required
            headerParameters["Authorization"] = await this.configuration.accessToken("external-access-token", []);
        }

        if (this.configuration && (this.configuration.username !== undefined || this.configuration.password !== undefined)) {
            headerParameters["Authorization"] = "Basic " + btoa(this.configuration.username + ":" + this.configuration.password);
        }
        const response = await this.request({
            path: `/exporters/{name}`.replace(`{${"name"}}`, encodeURIComponent(String(requestParameters['name']))),
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        }, initOverrides);

        return new runtime.JSONApiResponse(response, (jsonValue) => ExporterReferenceFromJSON(jsonValue));
    }

    /**
     * Retrieves the information of the schema exporter.
     * Gets schema exporter by name
     */
    async getExporterInfoByName(requestParameters: GetExporterInfoByNameRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<ExporterReference> {
        const response = await this.getExporterInfoByNameRaw(requestParameters, initOverrides);
        return await response.value();
    }

    /**
     * Retrieves the status of the schema exporter.
     * Gets schema exporter status by name
     */
    async getExporterStatusByNameRaw(requestParameters: GetExporterStatusByNameRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<ExporterStatusResponse>> {
        if (requestParameters['name'] == null) {
            throw new runtime.RequiredError(
                'name',
                'Required parameter "name" was null or undefined when calling getExporterStatusByName().'
            );
        }

        const queryParameters: any = {};

        const headerParameters: runtime.HTTPHeaders = {};

        if (this.configuration && this.configuration.accessToken) {
            // oauth required
            headerParameters["Authorization"] = await this.configuration.accessToken("external-access-token", []);
        }

        if (this.configuration && (this.configuration.username !== undefined || this.configuration.password !== undefined)) {
            headerParameters["Authorization"] = "Basic " + btoa(this.configuration.username + ":" + this.configuration.password);
        }
        const response = await this.request({
            path: `/exporters/{name}/status`.replace(`{${"name"}}`, encodeURIComponent(String(requestParameters['name']))),
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        }, initOverrides);

        return new runtime.JSONApiResponse(response, (jsonValue) => ExporterStatusResponseFromJSON(jsonValue));
    }

    /**
     * Retrieves the status of the schema exporter.
     * Gets schema exporter status by name
     */
    async getExporterStatusByName(requestParameters: GetExporterStatusByNameRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<ExporterStatusResponse> {
        const response = await this.getExporterStatusByNameRaw(requestParameters, initOverrides);
        return await response.value();
    }

    /**
     * Retrieves a list of schema exporters that have been created.
     * Gets all schema exporters
     */
    async listExportersRaw(initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<Array<string>>> {
        const queryParameters: any = {};

        const headerParameters: runtime.HTTPHeaders = {};

        if (this.configuration && this.configuration.accessToken) {
            // oauth required
            headerParameters["Authorization"] = await this.configuration.accessToken("external-access-token", []);
        }

        if (this.configuration && (this.configuration.username !== undefined || this.configuration.password !== undefined)) {
            headerParameters["Authorization"] = "Basic " + btoa(this.configuration.username + ":" + this.configuration.password);
        }
        const response = await this.request({
            path: `/exporters`,
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        }, initOverrides);

        return new runtime.JSONApiResponse<any>(response);
    }

    /**
     * Retrieves a list of schema exporters that have been created.
     * Gets all schema exporters
     */
    async listExporters(initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<Array<string>> {
        const response = await this.listExportersRaw(initOverrides);
        return await response.value();
    }

    /**
     * Pauses the state of the schema exporter.
     * Pause schema exporter by name
     */
    async pauseExporterByNameRaw(requestParameters: PauseExporterByNameRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<ExporterResponse>> {
        if (requestParameters['name'] == null) {
            throw new runtime.RequiredError(
                'name',
                'Required parameter "name" was null or undefined when calling pauseExporterByName().'
            );
        }

        const queryParameters: any = {};

        const headerParameters: runtime.HTTPHeaders = {};

        if (this.configuration && this.configuration.accessToken) {
            // oauth required
            headerParameters["Authorization"] = await this.configuration.accessToken("external-access-token", []);
        }

        if (this.configuration && (this.configuration.username !== undefined || this.configuration.password !== undefined)) {
            headerParameters["Authorization"] = "Basic " + btoa(this.configuration.username + ":" + this.configuration.password);
        }
        const response = await this.request({
            path: `/exporters/{name}/pause`.replace(`{${"name"}}`, encodeURIComponent(String(requestParameters['name']))),
            method: 'PUT',
            headers: headerParameters,
            query: queryParameters,
        }, initOverrides);

        return new runtime.JSONApiResponse(response, (jsonValue) => ExporterResponseFromJSON(jsonValue));
    }

    /**
     * Pauses the state of the schema exporter.
     * Pause schema exporter by name
     */
    async pauseExporterByName(requestParameters: PauseExporterByNameRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<ExporterResponse> {
        const response = await this.pauseExporterByNameRaw(requestParameters, initOverrides);
        return await response.value();
    }

    /**
     * Creates a new schema exporter. All attributes in request body are optional except config.
     * Creates a new schema exporter
     */
    async registerExporterRaw(requestParameters: RegisterExporterRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<ExporterResponse>> {
        if (requestParameters['ExporterReference'] == null) {
            throw new runtime.RequiredError(
                'ExporterReference',
                'Required parameter "ExporterReference" was null or undefined when calling registerExporter().'
            );
        }

        const queryParameters: any = {};

        const headerParameters: runtime.HTTPHeaders = {};

        headerParameters['Content-Type'] = 'application/vnd.schemaregistry.v1+json';

        if (this.configuration && this.configuration.accessToken) {
            // oauth required
            headerParameters["Authorization"] = await this.configuration.accessToken("external-access-token", []);
        }

        if (this.configuration && (this.configuration.username !== undefined || this.configuration.password !== undefined)) {
            headerParameters["Authorization"] = "Basic " + btoa(this.configuration.username + ":" + this.configuration.password);
        }
        const response = await this.request({
            path: `/exporters`,
            method: 'POST',
            headers: headerParameters,
            query: queryParameters,
            body: ExporterReferenceToJSON(requestParameters['ExporterReference']),
        }, initOverrides);

        return new runtime.JSONApiResponse(response, (jsonValue) => ExporterResponseFromJSON(jsonValue));
    }

    /**
     * Creates a new schema exporter. All attributes in request body are optional except config.
     * Creates a new schema exporter
     */
    async registerExporter(requestParameters: RegisterExporterRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<ExporterResponse> {
        const response = await this.registerExporterRaw(requestParameters, initOverrides);
        return await response.value();
    }

    /**
     * Reset the state of the schema exporter.
     * Reset schema exporter by name
     */
    async resetExporterByNameRaw(requestParameters: ResetExporterByNameRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<ExporterResponse>> {
        if (requestParameters['name'] == null) {
            throw new runtime.RequiredError(
                'name',
                'Required parameter "name" was null or undefined when calling resetExporterByName().'
            );
        }

        const queryParameters: any = {};

        const headerParameters: runtime.HTTPHeaders = {};

        if (this.configuration && this.configuration.accessToken) {
            // oauth required
            headerParameters["Authorization"] = await this.configuration.accessToken("external-access-token", []);
        }

        if (this.configuration && (this.configuration.username !== undefined || this.configuration.password !== undefined)) {
            headerParameters["Authorization"] = "Basic " + btoa(this.configuration.username + ":" + this.configuration.password);
        }
        const response = await this.request({
            path: `/exporters/{name}/reset`.replace(`{${"name"}}`, encodeURIComponent(String(requestParameters['name']))),
            method: 'PUT',
            headers: headerParameters,
            query: queryParameters,
        }, initOverrides);

        return new runtime.JSONApiResponse(response, (jsonValue) => ExporterResponseFromJSON(jsonValue));
    }

    /**
     * Reset the state of the schema exporter.
     * Reset schema exporter by name
     */
    async resetExporterByName(requestParameters: ResetExporterByNameRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<ExporterResponse> {
        const response = await this.resetExporterByNameRaw(requestParameters, initOverrides);
        return await response.value();
    }

    /**
     * Resume running of the schema exporter.
     * Resume schema exporter by name
     */
    async resumeExporterByNameRaw(requestParameters: ResumeExporterByNameRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<ExporterResponse>> {
        if (requestParameters['name'] == null) {
            throw new runtime.RequiredError(
                'name',
                'Required parameter "name" was null or undefined when calling resumeExporterByName().'
            );
        }

        const queryParameters: any = {};

        const headerParameters: runtime.HTTPHeaders = {};

        if (this.configuration && this.configuration.accessToken) {
            // oauth required
            headerParameters["Authorization"] = await this.configuration.accessToken("external-access-token", []);
        }

        if (this.configuration && (this.configuration.username !== undefined || this.configuration.password !== undefined)) {
            headerParameters["Authorization"] = "Basic " + btoa(this.configuration.username + ":" + this.configuration.password);
        }
        const response = await this.request({
            path: `/exporters/{name}/resume`.replace(`{${"name"}}`, encodeURIComponent(String(requestParameters['name']))),
            method: 'PUT',
            headers: headerParameters,
            query: queryParameters,
        }, initOverrides);

        return new runtime.JSONApiResponse(response, (jsonValue) => ExporterResponseFromJSON(jsonValue));
    }

    /**
     * Resume running of the schema exporter.
     * Resume schema exporter by name
     */
    async resumeExporterByName(requestParameters: ResumeExporterByNameRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<ExporterResponse> {
        const response = await this.resumeExporterByNameRaw(requestParameters, initOverrides);
        return await response.value();
    }

    /**
     * Retrieves the config of the schema exporter.
     * Update schema exporter config by name
     */
    async updateExporterConfigByNameRaw(requestParameters: UpdateExporterConfigByNameRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<ExporterResponse>> {
        if (requestParameters['name'] == null) {
            throw new runtime.RequiredError(
                'name',
                'Required parameter "name" was null or undefined when calling updateExporterConfigByName().'
            );
        }

        if (requestParameters['ExporterConfigResponse'] == null) {
            throw new runtime.RequiredError(
                'ExporterConfigResponse',
                'Required parameter "ExporterConfigResponse" was null or undefined when calling updateExporterConfigByName().'
            );
        }

        const queryParameters: any = {};

        const headerParameters: runtime.HTTPHeaders = {};

        headerParameters['Content-Type'] = 'application/vnd.schemaregistry.v1+json';

        if (this.configuration && this.configuration.accessToken) {
            // oauth required
            headerParameters["Authorization"] = await this.configuration.accessToken("external-access-token", []);
        }

        if (this.configuration && (this.configuration.username !== undefined || this.configuration.password !== undefined)) {
            headerParameters["Authorization"] = "Basic " + btoa(this.configuration.username + ":" + this.configuration.password);
        }
        const response = await this.request({
            path: `/exporters/{name}/config`.replace(`{${"name"}}`, encodeURIComponent(String(requestParameters['name']))),
            method: 'PUT',
            headers: headerParameters,
            query: queryParameters,
            body: ExporterConfigResponseToJSON(requestParameters['ExporterConfigResponse']),
        }, initOverrides);

        return new runtime.JSONApiResponse(response, (jsonValue) => ExporterResponseFromJSON(jsonValue));
    }

    /**
     * Retrieves the config of the schema exporter.
     * Update schema exporter config by name
     */
    async updateExporterConfigByName(requestParameters: UpdateExporterConfigByNameRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<ExporterResponse> {
        const response = await this.updateExporterConfigByNameRaw(requestParameters, initOverrides);
        return await response.value();
    }

    /**
     * Updates the information or configurations of the schema exporter. All attributes in request body are optional.
     * Update schema exporter by name
     */
    async updateExporterInfoRaw(requestParameters: UpdateExporterInfoRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<ExporterResponse>> {
        if (requestParameters['name'] == null) {
            throw new runtime.RequiredError(
                'name',
                'Required parameter "name" was null or undefined when calling updateExporterInfo().'
            );
        }

        if (requestParameters['ExporterUpdateRequest'] == null) {
            throw new runtime.RequiredError(
                'ExporterUpdateRequest',
                'Required parameter "ExporterUpdateRequest" was null or undefined when calling updateExporterInfo().'
            );
        }

        const queryParameters: any = {};

        const headerParameters: runtime.HTTPHeaders = {};

        headerParameters['Content-Type'] = 'application/vnd.schemaregistry.v1+json';

        if (this.configuration && this.configuration.accessToken) {
            // oauth required
            headerParameters["Authorization"] = await this.configuration.accessToken("external-access-token", []);
        }

        if (this.configuration && (this.configuration.username !== undefined || this.configuration.password !== undefined)) {
            headerParameters["Authorization"] = "Basic " + btoa(this.configuration.username + ":" + this.configuration.password);
        }
        const response = await this.request({
            path: `/exporters/{name}`.replace(`{${"name"}}`, encodeURIComponent(String(requestParameters['name']))),
            method: 'PUT',
            headers: headerParameters,
            query: queryParameters,
            body: ExporterUpdateRequestToJSON(requestParameters['ExporterUpdateRequest']),
        }, initOverrides);

        return new runtime.JSONApiResponse(response, (jsonValue) => ExporterResponseFromJSON(jsonValue));
    }

    /**
     * Updates the information or configurations of the schema exporter. All attributes in request body are optional.
     * Update schema exporter by name
     */
    async updateExporterInfo(requestParameters: UpdateExporterInfoRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<ExporterResponse> {
        const response = await this.updateExporterInfoRaw(requestParameters, initOverrides);
        return await response.value();
    }

}
