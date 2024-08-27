/* tslint:disable */
/* eslint-disable */
/**
 * Confluent ide-sidecar API
 * API for the Confluent ide-sidecar, part of the Confluent extension for VS Code
 *
 * The version of the OpenAPI document: 1.0.1
 * Contact: vscode@confluent.io
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */

import * as runtime from "../runtime";
import type { SupportedFeature, SupportedFeatureList } from "../models/index";
import {
  SupportedFeatureFromJSON,
  SupportedFeatureToJSON,
  SupportedFeatureListFromJSON,
  SupportedFeatureListToJSON,
} from "../models/index";

export interface GatewayV1FeaturesFeatureNameGetRequest {
  featureName: string;
}

/**
 *
 */
export class FeaturesResourceApi extends runtime.BaseAPI {
  /**
   */
  async gatewayV1FeaturesFeatureNameGetRaw(
    requestParameters: GatewayV1FeaturesFeatureNameGetRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<runtime.ApiResponse<SupportedFeature>> {
    if (requestParameters["featureName"] == null) {
      throw new runtime.RequiredError(
        "featureName",
        'Required parameter "featureName" was null or undefined when calling gatewayV1FeaturesFeatureNameGet().',
      );
    }

    const queryParameters: any = {};

    const headerParameters: runtime.HTTPHeaders = {};

    const response = await this.request(
      {
        path: `/gateway/v1/features/{featureName}`.replace(
          `{${"featureName"}}`,
          encodeURIComponent(String(requestParameters["featureName"])),
        ),
        method: "GET",
        headers: headerParameters,
        query: queryParameters,
      },
      initOverrides,
    );

    return new runtime.JSONApiResponse(response, (jsonValue) =>
      SupportedFeatureFromJSON(jsonValue),
    );
  }

  /**
   */
  async gatewayV1FeaturesFeatureNameGet(
    requestParameters: GatewayV1FeaturesFeatureNameGetRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<SupportedFeature> {
    const response = await this.gatewayV1FeaturesFeatureNameGetRaw(
      requestParameters,
      initOverrides,
    );
    return await response.value();
  }

  /**
   */
  async gatewayV1FeaturesGetRaw(
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<runtime.ApiResponse<SupportedFeatureList>> {
    const queryParameters: any = {};

    const headerParameters: runtime.HTTPHeaders = {};

    const response = await this.request(
      {
        path: `/gateway/v1/features`,
        method: "GET",
        headers: headerParameters,
        query: queryParameters,
      },
      initOverrides,
    );

    return new runtime.JSONApiResponse(response, (jsonValue) =>
      SupportedFeatureListFromJSON(jsonValue),
    );
  }

  /**
   */
  async gatewayV1FeaturesGet(
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<SupportedFeatureList> {
    const response = await this.gatewayV1FeaturesGetRaw(initOverrides);
    return await response.value();
  }
}
