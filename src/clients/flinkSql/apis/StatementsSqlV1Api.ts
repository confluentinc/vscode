/* tslint:disable */
/* eslint-disable */
/**
 * SQL API v1
 * No description provided (generated by Openapi Generator https://github.com/openapitools/openapi-generator)
 *
 * The version of the OpenAPI document: 0.0.1
 *
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */

import type {
  CreateSqlv1Statement201Response,
  CreateSqlv1StatementRequest,
  GetSqlv1Statement200Response,
  PatchRequestInner,
  SqlV1StatementList,
  UpdateSqlv1StatementRequest,
} from "../models/index";
import {
  CreateSqlv1Statement201ResponseFromJSON,
  CreateSqlv1StatementRequestToJSON,
  GetSqlv1Statement200ResponseFromJSON,
  PatchRequestInnerToJSON,
  SqlV1StatementListFromJSON,
  UpdateSqlv1StatementRequestToJSON,
} from "../models/index";
import * as runtime from "../runtime";

export interface CreateSqlv1StatementOperationRequest {
  organization_id: string;
  environment_id: string;
  CreateSqlv1StatementRequest?: CreateSqlv1StatementRequest;
}

export interface DeleteSqlv1StatementRequest {
  organization_id: string;
  environment_id: string;
  statement_name: string;
}

export interface GetSqlv1StatementRequest {
  organization_id: string;
  environment_id: string;
  statement_name: string;
}

export interface ListSqlv1StatementsRequest {
  organization_id: string;
  environment_id: string;
  spec_compute_pool_id?: string;
  page_size?: number;
  page_token?: string;
  label_selector?: string;
}

export interface PatchSqlv1StatementRequest {
  organization_id: string;
  environment_id: string;
  statement_name: string;
  PatchRequestInner?: Array<PatchRequestInner>;
}

export interface UpdateSqlv1StatementOperationRequest {
  organization_id: string;
  environment_id: string;
  statement_name: string;
  UpdateSqlv1StatementRequest?: UpdateSqlv1StatementRequest;
}

/**
 *
 */
export class StatementsSqlV1Api extends runtime.BaseAPI {
  /**
   * [![General Availability](https://img.shields.io/badge/Lifecycle%20Stage-General%20Availability-%2345c6e8)](#section/Versioning/API-Lifecycle-Policy)  Make a request to create a statement.
   * Create a Statement
   */
  async createSqlv1StatementRaw(
    requestParameters: CreateSqlv1StatementOperationRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<runtime.ApiResponse<CreateSqlv1Statement201Response>> {
    if (requestParameters["organization_id"] == null) {
      throw new runtime.RequiredError(
        "organization_id",
        'Required parameter "organization_id" was null or undefined when calling createSqlv1Statement().',
      );
    }

    if (requestParameters["environment_id"] == null) {
      throw new runtime.RequiredError(
        "environment_id",
        'Required parameter "environment_id" was null or undefined when calling createSqlv1Statement().',
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
    const response = await this.request(
      {
        path: `/sql/v1/organizations/{organization_id}/environments/{environment_id}/statements`
          .replace(
            `{${"organization_id"}}`,
            encodeURIComponent(String(requestParameters["organization_id"])),
          )
          .replace(
            `{${"environment_id"}}`,
            encodeURIComponent(String(requestParameters["environment_id"])),
          ),
        method: "POST",
        headers: headerParameters,
        query: queryParameters,
        body: CreateSqlv1StatementRequestToJSON(requestParameters["CreateSqlv1StatementRequest"]),
      },
      initOverrides,
    );

    return new runtime.JSONApiResponse(response, (jsonValue) =>
      CreateSqlv1Statement201ResponseFromJSON(jsonValue),
    );
  }

  /**
   * [![General Availability](https://img.shields.io/badge/Lifecycle%20Stage-General%20Availability-%2345c6e8)](#section/Versioning/API-Lifecycle-Policy)  Make a request to create a statement.
   * Create a Statement
   */
  async createSqlv1Statement(
    requestParameters: CreateSqlv1StatementOperationRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<CreateSqlv1Statement201Response> {
    const response = await this.createSqlv1StatementRaw(requestParameters, initOverrides);
    return await response.value();
  }

  /**
   * [![General Availability](https://img.shields.io/badge/Lifecycle%20Stage-General%20Availability-%2345c6e8)](#section/Versioning/API-Lifecycle-Policy)  Make a request to delete a statement.
   * Delete a Statement
   */
  async deleteSqlv1StatementRaw(
    requestParameters: DeleteSqlv1StatementRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<runtime.ApiResponse<void>> {
    if (requestParameters["organization_id"] == null) {
      throw new runtime.RequiredError(
        "organization_id",
        'Required parameter "organization_id" was null or undefined when calling deleteSqlv1Statement().',
      );
    }

    if (requestParameters["environment_id"] == null) {
      throw new runtime.RequiredError(
        "environment_id",
        'Required parameter "environment_id" was null or undefined when calling deleteSqlv1Statement().',
      );
    }

    if (requestParameters["statement_name"] == null) {
      throw new runtime.RequiredError(
        "statement_name",
        'Required parameter "statement_name" was null or undefined when calling deleteSqlv1Statement().',
      );
    }

    const queryParameters: any = {};

    const headerParameters: runtime.HTTPHeaders = {};

    if (
      this.configuration &&
      (this.configuration.username !== undefined || this.configuration.password !== undefined)
    ) {
      headerParameters["Authorization"] =
        "Basic " + btoa(this.configuration.username + ":" + this.configuration.password);
    }
    const response = await this.request(
      {
        path: `/sql/v1/organizations/{organization_id}/environments/{environment_id}/statements/{statement_name}`
          .replace(
            `{${"organization_id"}}`,
            encodeURIComponent(String(requestParameters["organization_id"])),
          )
          .replace(
            `{${"environment_id"}}`,
            encodeURIComponent(String(requestParameters["environment_id"])),
          )
          .replace(
            `{${"statement_name"}}`,
            encodeURIComponent(String(requestParameters["statement_name"])),
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
   * [![General Availability](https://img.shields.io/badge/Lifecycle%20Stage-General%20Availability-%2345c6e8)](#section/Versioning/API-Lifecycle-Policy)  Make a request to delete a statement.
   * Delete a Statement
   */
  async deleteSqlv1Statement(
    requestParameters: DeleteSqlv1StatementRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<void> {
    await this.deleteSqlv1StatementRaw(requestParameters, initOverrides);
  }

  /**
   * [![General Availability](https://img.shields.io/badge/Lifecycle%20Stage-General%20Availability-%2345c6e8)](#section/Versioning/API-Lifecycle-Policy)  Make a request to read a statement.
   * Read a Statement
   */
  async getSqlv1StatementRaw(
    requestParameters: GetSqlv1StatementRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<runtime.ApiResponse<GetSqlv1Statement200Response>> {
    if (requestParameters["organization_id"] == null) {
      throw new runtime.RequiredError(
        "organization_id",
        'Required parameter "organization_id" was null or undefined when calling getSqlv1Statement().',
      );
    }

    if (requestParameters["environment_id"] == null) {
      throw new runtime.RequiredError(
        "environment_id",
        'Required parameter "environment_id" was null or undefined when calling getSqlv1Statement().',
      );
    }

    if (requestParameters["statement_name"] == null) {
      throw new runtime.RequiredError(
        "statement_name",
        'Required parameter "statement_name" was null or undefined when calling getSqlv1Statement().',
      );
    }

    const queryParameters: any = {};

    const headerParameters: runtime.HTTPHeaders = {};

    if (
      this.configuration &&
      (this.configuration.username !== undefined || this.configuration.password !== undefined)
    ) {
      headerParameters["Authorization"] =
        "Basic " + btoa(this.configuration.username + ":" + this.configuration.password);
    }
    const response = await this.request(
      {
        path: `/sql/v1/organizations/{organization_id}/environments/{environment_id}/statements/{statement_name}`
          .replace(
            `{${"organization_id"}}`,
            encodeURIComponent(String(requestParameters["organization_id"])),
          )
          .replace(
            `{${"environment_id"}}`,
            encodeURIComponent(String(requestParameters["environment_id"])),
          )
          .replace(
            `{${"statement_name"}}`,
            encodeURIComponent(String(requestParameters["statement_name"])),
          ),
        method: "GET",
        headers: headerParameters,
        query: queryParameters,
      },
      initOverrides,
    );

    return new runtime.JSONApiResponse(response, (jsonValue) =>
      GetSqlv1Statement200ResponseFromJSON(jsonValue),
    );
  }

  /**
   * [![General Availability](https://img.shields.io/badge/Lifecycle%20Stage-General%20Availability-%2345c6e8)](#section/Versioning/API-Lifecycle-Policy)  Make a request to read a statement.
   * Read a Statement
   */
  async getSqlv1Statement(
    requestParameters: GetSqlv1StatementRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<GetSqlv1Statement200Response> {
    const response = await this.getSqlv1StatementRaw(requestParameters, initOverrides);
    return await response.value();
  }

  /**
   * [![General Availability](https://img.shields.io/badge/Lifecycle%20Stage-General%20Availability-%2345c6e8)](#section/Versioning/API-Lifecycle-Policy)  Retrieve a sorted, filtered, paginated list of all statements.
   * List of Statements
   */
  async listSqlv1StatementsRaw(
    requestParameters: ListSqlv1StatementsRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<runtime.ApiResponse<SqlV1StatementList>> {
    if (requestParameters["organization_id"] == null) {
      throw new runtime.RequiredError(
        "organization_id",
        'Required parameter "organization_id" was null or undefined when calling listSqlv1Statements().',
      );
    }

    if (requestParameters["environment_id"] == null) {
      throw new runtime.RequiredError(
        "environment_id",
        'Required parameter "environment_id" was null or undefined when calling listSqlv1Statements().',
      );
    }

    const queryParameters: any = {};

    if (requestParameters["spec_compute_pool_id"] != null) {
      queryParameters["spec.compute_pool_id"] = requestParameters["spec_compute_pool_id"];
    }

    if (requestParameters["page_size"] != null) {
      queryParameters["page_size"] = requestParameters["page_size"];
    }

    if (requestParameters["page_token"] != null) {
      queryParameters["page_token"] = requestParameters["page_token"];
    }

    if (requestParameters["label_selector"] != null) {
      queryParameters["label_selector"] = requestParameters["label_selector"];
    }

    const headerParameters: runtime.HTTPHeaders = {};

    if (
      this.configuration &&
      (this.configuration.username !== undefined || this.configuration.password !== undefined)
    ) {
      headerParameters["Authorization"] =
        "Basic " + btoa(this.configuration.username + ":" + this.configuration.password);
    }
    const response = await this.request(
      {
        path: `/sql/v1/organizations/{organization_id}/environments/{environment_id}/statements`
          .replace(
            `{${"organization_id"}}`,
            encodeURIComponent(String(requestParameters["organization_id"])),
          )
          .replace(
            `{${"environment_id"}}`,
            encodeURIComponent(String(requestParameters["environment_id"])),
          ),
        method: "GET",
        headers: headerParameters,
        query: queryParameters,
      },
      initOverrides,
    );

    return new runtime.JSONApiResponse(response, (jsonValue) =>
      SqlV1StatementListFromJSON(jsonValue),
    );
  }

  /**
   * [![General Availability](https://img.shields.io/badge/Lifecycle%20Stage-General%20Availability-%2345c6e8)](#section/Versioning/API-Lifecycle-Policy)  Retrieve a sorted, filtered, paginated list of all statements.
   * List of Statements
   */
  async listSqlv1Statements(
    requestParameters: ListSqlv1StatementsRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<SqlV1StatementList> {
    const response = await this.listSqlv1StatementsRaw(requestParameters, initOverrides);
    return await response.value();
  }

  /**
   * [![Early Access](https://img.shields.io/badge/Lifecycle%20Stage-Early%20Access-%2345c6e8)](#section/Versioning/API-Lifecycle-Policy)  Make a request to patch a statement.
   * Patch a Statement
   */
  async patchSqlv1StatementRaw(
    requestParameters: PatchSqlv1StatementRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<runtime.ApiResponse<CreateSqlv1Statement201Response>> {
    if (requestParameters["organization_id"] == null) {
      throw new runtime.RequiredError(
        "organization_id",
        'Required parameter "organization_id" was null or undefined when calling patchSqlv1Statement().',
      );
    }

    if (requestParameters["environment_id"] == null) {
      throw new runtime.RequiredError(
        "environment_id",
        'Required parameter "environment_id" was null or undefined when calling patchSqlv1Statement().',
      );
    }

    if (requestParameters["statement_name"] == null) {
      throw new runtime.RequiredError(
        "statement_name",
        'Required parameter "statement_name" was null or undefined when calling patchSqlv1Statement().',
      );
    }

    const queryParameters: any = {};

    const headerParameters: runtime.HTTPHeaders = {};

    headerParameters["Content-Type"] = "application/json-patch+json";

    if (
      this.configuration &&
      (this.configuration.username !== undefined || this.configuration.password !== undefined)
    ) {
      headerParameters["Authorization"] =
        "Basic " + btoa(this.configuration.username + ":" + this.configuration.password);
    }
    const response = await this.request(
      {
        path: `/sql/v1/organizations/{organization_id}/environments/{environment_id}/statements/{statement_name}`
          .replace(
            `{${"organization_id"}}`,
            encodeURIComponent(String(requestParameters["organization_id"])),
          )
          .replace(
            `{${"environment_id"}}`,
            encodeURIComponent(String(requestParameters["environment_id"])),
          )
          .replace(
            `{${"statement_name"}}`,
            encodeURIComponent(String(requestParameters["statement_name"])),
          ),
        method: "PATCH",
        headers: headerParameters,
        query: queryParameters,
        body: requestParameters["PatchRequestInner"]!.map(PatchRequestInnerToJSON),
      },
      initOverrides,
    );

    return new runtime.JSONApiResponse(response, (jsonValue) =>
      CreateSqlv1Statement201ResponseFromJSON(jsonValue),
    );
  }

  /**
   * [![Early Access](https://img.shields.io/badge/Lifecycle%20Stage-Early%20Access-%2345c6e8)](#section/Versioning/API-Lifecycle-Policy)  Make a request to patch a statement.
   * Patch a Statement
   */
  async patchSqlv1Statement(
    requestParameters: PatchSqlv1StatementRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<CreateSqlv1Statement201Response> {
    const response = await this.patchSqlv1StatementRaw(requestParameters, initOverrides);
    return await response.value();
  }

  /**
   * [![General Availability](https://img.shields.io/badge/Lifecycle%20Stage-General%20Availability-%2345c6e8)](#section/Versioning/API-Lifecycle-Policy)  Make a request to update a statement. The request will fail with a 409 Conflict error if the Statement has changed since it was fetched. In this case, do a GET, reapply the modifications, and try the update again.
   * Update a Statement
   */
  async updateSqlv1StatementRaw(
    requestParameters: UpdateSqlv1StatementOperationRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<runtime.ApiResponse<void>> {
    if (requestParameters["organization_id"] == null) {
      throw new runtime.RequiredError(
        "organization_id",
        'Required parameter "organization_id" was null or undefined when calling updateSqlv1Statement().',
      );
    }

    if (requestParameters["environment_id"] == null) {
      throw new runtime.RequiredError(
        "environment_id",
        'Required parameter "environment_id" was null or undefined when calling updateSqlv1Statement().',
      );
    }

    if (requestParameters["statement_name"] == null) {
      throw new runtime.RequiredError(
        "statement_name",
        'Required parameter "statement_name" was null or undefined when calling updateSqlv1Statement().',
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
    const response = await this.request(
      {
        path: `/sql/v1/organizations/{organization_id}/environments/{environment_id}/statements/{statement_name}`
          .replace(
            `{${"organization_id"}}`,
            encodeURIComponent(String(requestParameters["organization_id"])),
          )
          .replace(
            `{${"environment_id"}}`,
            encodeURIComponent(String(requestParameters["environment_id"])),
          )
          .replace(
            `{${"statement_name"}}`,
            encodeURIComponent(String(requestParameters["statement_name"])),
          ),
        method: "PUT",
        headers: headerParameters,
        query: queryParameters,
        body: UpdateSqlv1StatementRequestToJSON(requestParameters["UpdateSqlv1StatementRequest"]),
      },
      initOverrides,
    );

    return new runtime.VoidApiResponse(response);
  }

  /**
   * [![General Availability](https://img.shields.io/badge/Lifecycle%20Stage-General%20Availability-%2345c6e8)](#section/Versioning/API-Lifecycle-Policy)  Make a request to update a statement. The request will fail with a 409 Conflict error if the Statement has changed since it was fetched. In this case, do a GET, reapply the modifications, and try the update again.
   * Update a Statement
   */
  async updateSqlv1Statement(
    requestParameters: UpdateSqlv1StatementOperationRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<void> {
    await this.updateSqlv1StatementRaw(requestParameters, initOverrides);
  }
}
