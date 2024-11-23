/* tslint:disable */
/* eslint-disable */
/**
 * Confluent ide-sidecar API
 * API for the Confluent ide-sidecar, part of Confluent for VS Code
 *
 * The version of the OpenAPI document: 1.0.1
 * Contact: vscode@confluent.io
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */


import * as runtime from '../runtime';
import type {
  Failure,
  JsonNode,
} from '../models/index';
import {
    FailureFromJSON,
    FailureToJSON,
    JsonNodeFromJSON,
    JsonNodeToJSON,
} from '../models/index';

export interface GatewayV1FeatureFlagsIdValueGetRequest {
    id: string;
}

/**
 * 
 */
export class FeatureFlagsApi extends runtime.BaseAPI {

    /**
     */
    async gatewayV1FeatureFlagsIdValueGetRaw(requestParameters: GatewayV1FeatureFlagsIdValueGetRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<JsonNode>> {
        if (requestParameters['id'] == null) {
            throw new runtime.RequiredError(
                'id',
                'Required parameter "id" was null or undefined when calling gatewayV1FeatureFlagsIdValueGet().'
            );
        }

        const queryParameters: any = {};

        const headerParameters: runtime.HTTPHeaders = {};

        const response = await this.request({
            path: `/gateway/v1/feature-flags/{id}/value`.replace(`{${"id"}}`, encodeURIComponent(String(requestParameters['id']))),
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        }, initOverrides);

        return new runtime.JSONApiResponse(response, (jsonValue) => JsonNodeFromJSON(jsonValue));
    }

    /**
     */
    async gatewayV1FeatureFlagsIdValueGet(requestParameters: GatewayV1FeatureFlagsIdValueGetRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<JsonNode> {
        const response = await this.gatewayV1FeatureFlagsIdValueGetRaw(requestParameters, initOverrides);
        return await response.value();
    }

}
