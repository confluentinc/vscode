/* tslint:disable */
/* eslint-disable */
/**
 * Flink Compute Pool Management API
 * This is the Flink Compute Pool management API.
 *
 * The version of the OpenAPI document: 0.0.1
 *
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */

import * as runtime from "../runtime";
import type {
  CreateFcpmV2ComputePool202Response,
  CreateFcpmV2ComputePoolRequest,
  Failure,
  GetFcpmV2ComputePool200Response,
  ListFcpmV2ComputePools200Response,
  UpdateFcpmV2ComputePoolRequest,
} from "../models/index";
import {
  CreateFcpmV2ComputePool202ResponseFromJSON,
  CreateFcpmV2ComputePool202ResponseToJSON,
  CreateFcpmV2ComputePoolRequestFromJSON,
  CreateFcpmV2ComputePoolRequestToJSON,
  FailureFromJSON,
  FailureToJSON,
  GetFcpmV2ComputePool200ResponseFromJSON,
  GetFcpmV2ComputePool200ResponseToJSON,
  ListFcpmV2ComputePools200ResponseFromJSON,
  ListFcpmV2ComputePools200ResponseToJSON,
  UpdateFcpmV2ComputePoolRequestFromJSON,
  UpdateFcpmV2ComputePoolRequestToJSON,
} from "../models/index";

export interface CreateFcpmV2ComputePoolOperationRequest {
  CreateFcpmV2ComputePoolRequest?: CreateFcpmV2ComputePoolRequest;
}

export interface DeleteFcpmV2ComputePoolRequest {
  environment: string;
  id: string;
}

export interface GetFcpmV2ComputePoolRequest {
  environment: string;
  id: string;
}

export interface ListFcpmV2ComputePoolsRequest {
  environment: string;
  spec_region?: string;
  spec_network?: string;
  page_size?: number;
  page_token?: string;
}

export interface UpdateFcpmV2ComputePoolOperationRequest {
  id: string;
  UpdateFcpmV2ComputePoolRequest?: UpdateFcpmV2ComputePoolRequest;
}

/**
 *
 */
export class ComputePoolsFcpmV2Api extends runtime.BaseAPI {
  /**
   * [![General Availability](https://img.shields.io/badge/Lifecycle%20Stage-General%20Availability-%2345c6e8)](#section/Versioning/API-Lifecycle-Policy)  Make a request to create a compute pool.
   * Create a Compute Pool
   */
  async createFcpmV2ComputePoolRaw(
    requestParameters: CreateFcpmV2ComputePoolOperationRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<runtime.ApiResponse<CreateFcpmV2ComputePool202Response>> {
    const queryParameters: any = {};

    const headerParameters: runtime.HTTPHeaders = {};

    headerParameters["Content-Type"] = "application/json";

    if (
      this.configuration &&
      (this.configuration.username !== undefined || this.configuration.password !== undefined)
    ) {
      headerParameters["Authorization"] =
        "Basic " + btoa(this.configuration.username + ":" + this.configuration.password);
    }
    if (this.configuration && this.configuration.accessToken) {
      // oauth required
      headerParameters["Authorization"] = await this.configuration.accessToken(
        "confluent-sts-access-token",
        [],
      );
    }

    const response = await this.request(
      {
        path: `/fcpm/v2/compute-pools`,
        method: "POST",
        headers: headerParameters,
        query: queryParameters,
        body: CreateFcpmV2ComputePoolRequestToJSON(
          requestParameters["CreateFcpmV2ComputePoolRequest"],
        ),
      },
      initOverrides,
    );

    return new runtime.JSONApiResponse(response, (jsonValue) =>
      CreateFcpmV2ComputePool202ResponseFromJSON(jsonValue),
    );
  }

  /**
   * [![General Availability](https://img.shields.io/badge/Lifecycle%20Stage-General%20Availability-%2345c6e8)](#section/Versioning/API-Lifecycle-Policy)  Make a request to create a compute pool.
   * Create a Compute Pool
   */
  async createFcpmV2ComputePool(
    requestParameters: CreateFcpmV2ComputePoolOperationRequest = {},
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<CreateFcpmV2ComputePool202Response> {
    const response = await this.createFcpmV2ComputePoolRaw(requestParameters, initOverrides);
    return await response.value();
  }

  /**
   * [![General Availability](https://img.shields.io/badge/Lifecycle%20Stage-General%20Availability-%2345c6e8)](#section/Versioning/API-Lifecycle-Policy)  Make a request to delete a compute pool.
   * Delete a Compute Pool
   */
  async deleteFcpmV2ComputePoolRaw(
    requestParameters: DeleteFcpmV2ComputePoolRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<runtime.ApiResponse<void>> {
    if (requestParameters["environment"] == null) {
      throw new runtime.RequiredError(
        "environment",
        'Required parameter "environment" was null or undefined when calling deleteFcpmV2ComputePool().',
      );
    }

    if (requestParameters["id"] == null) {
      throw new runtime.RequiredError(
        "id",
        'Required parameter "id" was null or undefined when calling deleteFcpmV2ComputePool().',
      );
    }

    const queryParameters: any = {};

    if (requestParameters["environment"] != null) {
      queryParameters["environment"] = requestParameters["environment"];
    }

    const headerParameters: runtime.HTTPHeaders = {};

    if (
      this.configuration &&
      (this.configuration.username !== undefined || this.configuration.password !== undefined)
    ) {
      headerParameters["Authorization"] =
        "Basic " + btoa(this.configuration.username + ":" + this.configuration.password);
    }
    if (this.configuration && this.configuration.accessToken) {
      // oauth required
      headerParameters["Authorization"] = await this.configuration.accessToken(
        "confluent-sts-access-token",
        [],
      );
    }

    const response = await this.request(
      {
        path: `/fcpm/v2/compute-pools/{id}`.replace(
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
   * [![General Availability](https://img.shields.io/badge/Lifecycle%20Stage-General%20Availability-%2345c6e8)](#section/Versioning/API-Lifecycle-Policy)  Make a request to delete a compute pool.
   * Delete a Compute Pool
   */
  async deleteFcpmV2ComputePool(
    requestParameters: DeleteFcpmV2ComputePoolRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<void> {
    await this.deleteFcpmV2ComputePoolRaw(requestParameters, initOverrides);
  }

  /**
   * [![General Availability](https://img.shields.io/badge/Lifecycle%20Stage-General%20Availability-%2345c6e8)](#section/Versioning/API-Lifecycle-Policy)  Make a request to read a compute pool.
   * Read a Compute Pool
   */
  async getFcpmV2ComputePoolRaw(
    requestParameters: GetFcpmV2ComputePoolRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<runtime.ApiResponse<GetFcpmV2ComputePool200Response>> {
    if (requestParameters["environment"] == null) {
      throw new runtime.RequiredError(
        "environment",
        'Required parameter "environment" was null or undefined when calling getFcpmV2ComputePool().',
      );
    }

    if (requestParameters["id"] == null) {
      throw new runtime.RequiredError(
        "id",
        'Required parameter "id" was null or undefined when calling getFcpmV2ComputePool().',
      );
    }

    const queryParameters: any = {};

    if (requestParameters["environment"] != null) {
      queryParameters["environment"] = requestParameters["environment"];
    }

    const headerParameters: runtime.HTTPHeaders = {};

    if (
      this.configuration &&
      (this.configuration.username !== undefined || this.configuration.password !== undefined)
    ) {
      headerParameters["Authorization"] =
        "Basic " + btoa(this.configuration.username + ":" + this.configuration.password);
    }
    if (this.configuration && this.configuration.accessToken) {
      // oauth required
      headerParameters["Authorization"] = await this.configuration.accessToken(
        "confluent-sts-access-token",
        [],
      );
    }

    const response = await this.request(
      {
        path: `/fcpm/v2/compute-pools/{id}`.replace(
          `{${"id"}}`,
          encodeURIComponent(String(requestParameters["id"])),
        ),
        method: "GET",
        headers: headerParameters,
        query: queryParameters,
      },
      initOverrides,
    );

    return new runtime.JSONApiResponse(response, (jsonValue) =>
      GetFcpmV2ComputePool200ResponseFromJSON(jsonValue),
    );
  }

  /**
   * [![General Availability](https://img.shields.io/badge/Lifecycle%20Stage-General%20Availability-%2345c6e8)](#section/Versioning/API-Lifecycle-Policy)  Make a request to read a compute pool.
   * Read a Compute Pool
   */
  async getFcpmV2ComputePool(
    requestParameters: GetFcpmV2ComputePoolRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<GetFcpmV2ComputePool200Response> {
    const response = await this.getFcpmV2ComputePoolRaw(requestParameters, initOverrides);
    return await response.value();
  }

  /**
   * [![General Availability](https://img.shields.io/badge/Lifecycle%20Stage-General%20Availability-%2345c6e8)](#section/Versioning/API-Lifecycle-Policy)  Retrieve a sorted, filtered, paginated list of all compute pools.
   * List of Compute Pools
   */
  async listFcpmV2ComputePoolsRaw(
    requestParameters: ListFcpmV2ComputePoolsRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<runtime.ApiResponse<ListFcpmV2ComputePools200Response>> {
    if (requestParameters["environment"] == null) {
      throw new runtime.RequiredError(
        "environment",
        'Required parameter "environment" was null or undefined when calling listFcpmV2ComputePools().',
      );
    }

    const queryParameters: any = {};

    if (requestParameters["spec_region"] != null) {
      queryParameters["spec.region"] = requestParameters["spec_region"];
    }

    if (requestParameters["environment"] != null) {
      queryParameters["environment"] = requestParameters["environment"];
    }

    if (requestParameters["spec_network"] != null) {
      queryParameters["spec.network"] = requestParameters["spec_network"];
    }

    if (requestParameters["page_size"] != null) {
      queryParameters["page_size"] = requestParameters["page_size"];
    }

    if (requestParameters["page_token"] != null) {
      queryParameters["page_token"] = requestParameters["page_token"];
    }

    const headerParameters: runtime.HTTPHeaders = {};

    if (
      this.configuration &&
      (this.configuration.username !== undefined || this.configuration.password !== undefined)
    ) {
      headerParameters["Authorization"] =
        "Basic " + btoa(this.configuration.username + ":" + this.configuration.password);
    }
    if (this.configuration && this.configuration.accessToken) {
      // oauth required
      headerParameters["Authorization"] = await this.configuration.accessToken(
        "confluent-sts-access-token",
        [],
      );
    }

    const response = await this.request(
      {
        path: `/fcpm/v2/compute-pools`,
        method: "GET",
        headers: headerParameters,
        query: queryParameters,
      },
      initOverrides,
    );

    return new runtime.JSONApiResponse(response, (jsonValue) =>
      ListFcpmV2ComputePools200ResponseFromJSON(jsonValue),
    );
  }

  /**
   * [![General Availability](https://img.shields.io/badge/Lifecycle%20Stage-General%20Availability-%2345c6e8)](#section/Versioning/API-Lifecycle-Policy)  Retrieve a sorted, filtered, paginated list of all compute pools.
   * List of Compute Pools
   */
  async listFcpmV2ComputePools(
    requestParameters: ListFcpmV2ComputePoolsRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<ListFcpmV2ComputePools200Response> {
    const response = await this.listFcpmV2ComputePoolsRaw(requestParameters, initOverrides);
    return await response.value();
  }

  /**
   * [![General Availability](https://img.shields.io/badge/Lifecycle%20Stage-General%20Availability-%2345c6e8)](#section/Versioning/API-Lifecycle-Policy)  Make a request to update a compute pool.
   * Update a Compute Pool
   */
  async updateFcpmV2ComputePoolRaw(
    requestParameters: UpdateFcpmV2ComputePoolOperationRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<runtime.ApiResponse<GetFcpmV2ComputePool200Response>> {
    if (requestParameters["id"] == null) {
      throw new runtime.RequiredError(
        "id",
        'Required parameter "id" was null or undefined when calling updateFcpmV2ComputePool().',
      );
    }

    const queryParameters: any = {};

    const headerParameters: runtime.HTTPHeaders = {};

    headerParameters["Content-Type"] = "application/json";

    if (
      this.configuration &&
      (this.configuration.username !== undefined || this.configuration.password !== undefined)
    ) {
      headerParameters["Authorization"] =
        "Basic " + btoa(this.configuration.username + ":" + this.configuration.password);
    }
    if (this.configuration && this.configuration.accessToken) {
      // oauth required
      headerParameters["Authorization"] = await this.configuration.accessToken(
        "confluent-sts-access-token",
        [],
      );
    }

    const response = await this.request(
      {
        path: `/fcpm/v2/compute-pools/{id}`.replace(
          `{${"id"}}`,
          encodeURIComponent(String(requestParameters["id"])),
        ),
        method: "PATCH",
        headers: headerParameters,
        query: queryParameters,
        body: UpdateFcpmV2ComputePoolRequestToJSON(
          requestParameters["UpdateFcpmV2ComputePoolRequest"],
        ),
      },
      initOverrides,
    );

    return new runtime.JSONApiResponse(response, (jsonValue) =>
      GetFcpmV2ComputePool200ResponseFromJSON(jsonValue),
    );
  }

  /**
   * [![General Availability](https://img.shields.io/badge/Lifecycle%20Stage-General%20Availability-%2345c6e8)](#section/Versioning/API-Lifecycle-Policy)  Make a request to update a compute pool.
   * Update a Compute Pool
   */
  async updateFcpmV2ComputePool(
    requestParameters: UpdateFcpmV2ComputePoolOperationRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<GetFcpmV2ComputePool200Response> {
    const response = await this.updateFcpmV2ComputePoolRaw(requestParameters, initOverrides);
    return await response.value();
  }
}
