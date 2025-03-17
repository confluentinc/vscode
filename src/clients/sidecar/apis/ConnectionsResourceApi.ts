/* tslint:disable */
/* eslint-disable */
/**
 * Confluent ide-sidecar API
 * API for the Confluent ide-sidecar, part of Confluent for VS Code
 *
 * The version of the OpenAPI document: 0.177.0
 * Contact: vscode@confluent.io
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */

import * as runtime from "../runtime";
import type { Connection, ConnectionSpec, ConnectionsList, Failure } from "../models/index";
import {
  ConnectionFromJSON,
  ConnectionToJSON,
  ConnectionSpecFromJSON,
  ConnectionSpecToJSON,
  ConnectionsListFromJSON,
  ConnectionsListToJSON,
  FailureFromJSON,
  FailureToJSON,
} from "../models/index";

export interface GatewayV1ConnectionsIdDeleteRequest {
  id: string;
}

export interface GatewayV1ConnectionsIdGetRequest {
  id: string;
}

export interface GatewayV1ConnectionsIdPatchRequest {
  id: string;
  body?: object;
}

export interface GatewayV1ConnectionsIdPutRequest {
  id: string;
  ConnectionSpec?: ConnectionSpec;
}

export interface GatewayV1ConnectionsPostRequest {
  dry_run?: boolean;
  ConnectionSpec?: ConnectionSpec;
}

/**
 *
 */
export class ConnectionsResourceApi extends runtime.BaseAPI {
  /**
   */
  async gatewayV1ConnectionsGetRaw(
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<runtime.ApiResponse<ConnectionsList>> {
    const queryParameters: any = {};

    const headerParameters: runtime.HTTPHeaders = {};

    const response = await this.request(
      {
        path: `/gateway/v1/connections`,
        method: "GET",
        headers: headerParameters,
        query: queryParameters,
      },
      initOverrides,
    );

    return new runtime.JSONApiResponse(response, (jsonValue) => ConnectionsListFromJSON(jsonValue));
  }

  /**
   */
  async gatewayV1ConnectionsGet(
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<ConnectionsList> {
    const response = await this.gatewayV1ConnectionsGetRaw(initOverrides);
    return await response.value();
  }

  /**
   */
  async gatewayV1ConnectionsIdDeleteRaw(
    requestParameters: GatewayV1ConnectionsIdDeleteRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<runtime.ApiResponse<void>> {
    if (requestParameters["id"] == null) {
      throw new runtime.RequiredError(
        "id",
        'Required parameter "id" was null or undefined when calling gatewayV1ConnectionsIdDelete().',
      );
    }

    const queryParameters: any = {};

    const headerParameters: runtime.HTTPHeaders = {};

    const response = await this.request(
      {
        path: `/gateway/v1/connections/{id}`.replace(
          `{${"id"}}`,
          encodeURIComponent(String(requestParameters["id"])),
        ),
        method: "DELETE",
        headers: headerParameters,
        query: queryParameters,
      },
      initOverrides,
    );

    return new runtime.VoidApiResponse(response);
  }

  /**
   */
  async gatewayV1ConnectionsIdDelete(
    requestParameters: GatewayV1ConnectionsIdDeleteRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<void> {
    await this.gatewayV1ConnectionsIdDeleteRaw(requestParameters, initOverrides);
  }

  /**
   */
  async gatewayV1ConnectionsIdGetRaw(
    requestParameters: GatewayV1ConnectionsIdGetRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<runtime.ApiResponse<Connection>> {
    if (requestParameters["id"] == null) {
      throw new runtime.RequiredError(
        "id",
        'Required parameter "id" was null or undefined when calling gatewayV1ConnectionsIdGet().',
      );
    }

    const queryParameters: any = {};

    const headerParameters: runtime.HTTPHeaders = {};

    const response = await this.request(
      {
        path: `/gateway/v1/connections/{id}`.replace(
          `{${"id"}}`,
          encodeURIComponent(String(requestParameters["id"])),
        ),
        method: "GET",
        headers: headerParameters,
        query: queryParameters,
      },
      initOverrides,
    );

    return new runtime.JSONApiResponse(response, (jsonValue) => ConnectionFromJSON(jsonValue));
  }

  /**
   */
  async gatewayV1ConnectionsIdGet(
    requestParameters: GatewayV1ConnectionsIdGetRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<Connection> {
    const response = await this.gatewayV1ConnectionsIdGetRaw(requestParameters, initOverrides);
    return await response.value();
  }

  /**
   */
  async gatewayV1ConnectionsIdPatchRaw(
    requestParameters: GatewayV1ConnectionsIdPatchRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<runtime.ApiResponse<Connection>> {
    if (requestParameters["id"] == null) {
      throw new runtime.RequiredError(
        "id",
        'Required parameter "id" was null or undefined when calling gatewayV1ConnectionsIdPatch().',
      );
    }

    const queryParameters: any = {};

    const headerParameters: runtime.HTTPHeaders = {};

    headerParameters["Content-Type"] = "application/json";

    const response = await this.request(
      {
        path: `/gateway/v1/connections/{id}`.replace(
          `{${"id"}}`,
          encodeURIComponent(String(requestParameters["id"])),
        ),
        method: "PATCH",
        headers: headerParameters,
        query: queryParameters,
        body: requestParameters["body"] as any,
      },
      initOverrides,
    );

    return new runtime.JSONApiResponse(response, (jsonValue) => ConnectionFromJSON(jsonValue));
  }

  /**
   */
  async gatewayV1ConnectionsIdPatch(
    requestParameters: GatewayV1ConnectionsIdPatchRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<Connection> {
    const response = await this.gatewayV1ConnectionsIdPatchRaw(requestParameters, initOverrides);
    return await response.value();
  }

  /**
   */
  async gatewayV1ConnectionsIdPutRaw(
    requestParameters: GatewayV1ConnectionsIdPutRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<runtime.ApiResponse<Connection>> {
    if (requestParameters["id"] == null) {
      throw new runtime.RequiredError(
        "id",
        'Required parameter "id" was null or undefined when calling gatewayV1ConnectionsIdPut().',
      );
    }

    const queryParameters: any = {};

    const headerParameters: runtime.HTTPHeaders = {};

    headerParameters["Content-Type"] = "application/json";

    const response = await this.request(
      {
        path: `/gateway/v1/connections/{id}`.replace(
          `{${"id"}}`,
          encodeURIComponent(String(requestParameters["id"])),
        ),
        method: "PUT",
        headers: headerParameters,
        query: queryParameters,
        body: ConnectionSpecToJSON(requestParameters["ConnectionSpec"]),
      },
      initOverrides,
    );

    return new runtime.JSONApiResponse(response, (jsonValue) => ConnectionFromJSON(jsonValue));
  }

  /**
   */
  async gatewayV1ConnectionsIdPut(
    requestParameters: GatewayV1ConnectionsIdPutRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<Connection> {
    const response = await this.gatewayV1ConnectionsIdPutRaw(requestParameters, initOverrides);
    return await response.value();
  }

  /**
   */
  async gatewayV1ConnectionsPostRaw(
    requestParameters: GatewayV1ConnectionsPostRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<runtime.ApiResponse<Connection>> {
    const queryParameters: any = {};

    if (requestParameters["dry_run"] != null) {
      queryParameters["dry_run"] = requestParameters["dry_run"];
    }

    const headerParameters: runtime.HTTPHeaders = {};

    headerParameters["Content-Type"] = "application/json";

    const response = await this.request(
      {
        path: `/gateway/v1/connections`,
        method: "POST",
        headers: headerParameters,
        query: queryParameters,
        body: ConnectionSpecToJSON(requestParameters["ConnectionSpec"]),
      },
      initOverrides,
    );

    return new runtime.JSONApiResponse(response, (jsonValue) => ConnectionFromJSON(jsonValue));
  }

  /**
   */
  async gatewayV1ConnectionsPost(
    requestParameters: GatewayV1ConnectionsPostRequest = {},
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<Connection> {
    const response = await this.gatewayV1ConnectionsPostRaw(requestParameters, initOverrides);
    return await response.value();
  }
}
