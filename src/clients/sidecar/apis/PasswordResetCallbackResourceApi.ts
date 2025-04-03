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

export interface RootGetRequest {
  email?: string;
  message?: string;
  success?: boolean;
}

/**
 *
 */
export class PasswordResetCallbackResourceApi extends runtime.BaseAPI {
  /**
   */
  async rootGetRaw(
    requestParameters: RootGetRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<runtime.ApiResponse<string>> {
    const queryParameters: any = {};

    if (requestParameters["email"] != null) {
      queryParameters["email"] = requestParameters["email"];
    }

    if (requestParameters["message"] != null) {
      queryParameters["message"] = requestParameters["message"];
    }

    if (requestParameters["success"] != null) {
      queryParameters["success"] = requestParameters["success"];
    }

    const headerParameters: runtime.HTTPHeaders = {};

    const response = await this.request(
      {
        path: `/`,
        method: "GET",
        headers: headerParameters,
        query: queryParameters,
      },
      initOverrides,
    );

    if (this.isJsonMime(response.headers.get("content-type"))) {
      return new runtime.JSONApiResponse<string>(response);
    } else {
      return new runtime.TextApiResponse(response) as any;
    }
  }

  /**
   */
  async rootGet(
    requestParameters: RootGetRequest = {},
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<string> {
    const response = await this.rootGetRaw(requestParameters, initOverrides);
    return await response.value();
  }
}
