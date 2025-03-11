/* tslint:disable */
/* eslint-disable */
/**
 * Confluent ide-sidecar API
 * API for the Confluent ide-sidecar, part of Confluent for VS Code
 *
 * The version of the OpenAPI document: 0.170.0
 * Contact: vscode@confluent.io
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */

import * as runtime from "../runtime";
import type { RBACRequest } from "../models/index";
import { RBACRequestFromJSON, RBACRequestToJSON } from "../models/index";

export interface ApiMetadataSecurityV2alpha1AuthorizePutRequest {
  RBACRequest: RBACRequest;
}

/**
 *
 */
export class DefaultApi extends runtime.BaseAPI {
  /**
   */
  async apiMetadataSecurityV2alpha1AuthorizePutRaw(
    requestParameters: ApiMetadataSecurityV2alpha1AuthorizePutRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<runtime.ApiResponse<Array<string>>> {
    if (requestParameters["RBACRequest"] == null) {
      throw new runtime.RequiredError(
        "RBACRequest",
        'Required parameter "RBACRequest" was null or undefined when calling apiMetadataSecurityV2alpha1AuthorizePut().',
      );
    }

    const queryParameters: any = {};

    const headerParameters: runtime.HTTPHeaders = {};

    headerParameters["Content-Type"] = "application/json";

    const response = await this.request(
      {
        path: `/api/metadata/security/v2alpha1/authorize`,
        method: "PUT",
        headers: headerParameters,
        query: queryParameters,
        body: RBACRequestToJSON(requestParameters["RBACRequest"]),
      },
      initOverrides,
    );

    return new runtime.JSONApiResponse<any>(response);
  }

  /**
   */
  async apiMetadataSecurityV2alpha1AuthorizePut(
    requestParameters: ApiMetadataSecurityV2alpha1AuthorizePutRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<Array<string>> {
    const response = await this.apiMetadataSecurityV2alpha1AuthorizePutRaw(
      requestParameters,
      initOverrides,
    );
    return await response.value();
  }
}
