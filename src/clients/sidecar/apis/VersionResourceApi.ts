/* tslint:disable */
/* eslint-disable */
/**
 * Confluent ide-sidecar API
 * API for the Confluent ide-sidecar, part of Confluent for VS Code
 *
 * The version of the OpenAPI document: 0.187.0
 * Contact: vscode@confluent.io
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */

import * as runtime from "../runtime";
import type { SidecarVersionResponse } from "../models/index";
import { SidecarVersionResponseFromJSON, SidecarVersionResponseToJSON } from "../models/index";

/**
 *
 */
export class VersionResourceApi extends runtime.BaseAPI {
  /**
   */
  async gatewayV1VersionGetRaw(
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<runtime.ApiResponse<SidecarVersionResponse>> {
    const queryParameters: any = {};

    const headerParameters: runtime.HTTPHeaders = {};

    const response = await this.request(
      {
        path: `/gateway/v1/version`,
        method: "GET",
        headers: headerParameters,
        query: queryParameters,
      },
      initOverrides,
    );

    return new runtime.JSONApiResponse(response, (jsonValue) =>
      SidecarVersionResponseFromJSON(jsonValue),
    );
  }

  /**
   */
  async gatewayV1VersionGet(
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<SidecarVersionResponse> {
    const response = await this.gatewayV1VersionGetRaw(initOverrides);
    return await response.value();
  }
}
