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

import * as runtime from "../runtime";
import type { CreateKekRequest, Kek, UpdateKekRequest } from "../models/index";
import {
  CreateKekRequestFromJSON,
  CreateKekRequestToJSON,
  KekFromJSON,
  KekToJSON,
  UpdateKekRequestFromJSON,
  UpdateKekRequestToJSON,
} from "../models/index";

export interface CreateKekOperationRequest {
  CreateKekRequest: CreateKekRequest;
}

export interface DeleteKekRequest {
  name: string;
  permanent?: boolean;
}

export interface GetKekRequest {
  name: string;
  deleted?: boolean;
}

export interface GetKekNamesRequest {
  deleted?: boolean;
}

export interface PutKekRequest {
  name: string;
  UpdateKekRequest: UpdateKekRequest;
}

export interface UndeleteKekRequest {
  name: string;
}

/**
 *
 */
export class KeyEncryptionKeysV1Api extends runtime.BaseAPI {
  /**
   * Create a kek
   */
  async createKekRaw(
    requestParameters: CreateKekOperationRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<runtime.ApiResponse<Kek>> {
    if (requestParameters["CreateKekRequest"] == null) {
      throw new runtime.RequiredError(
        "CreateKekRequest",
        'Required parameter "CreateKekRequest" was null or undefined when calling createKek().',
      );
    }

    const queryParameters: any = {};

    const headerParameters: runtime.HTTPHeaders = {};

    headerParameters["Content-Type"] = "application/vnd.schemaregistry.v1+json";

    if (this.configuration && this.configuration.accessToken) {
      // oauth required
      headerParameters["Authorization"] = await this.configuration.accessToken(
        "external-access-token",
        [],
      );
    }

    if (
      this.configuration &&
      (this.configuration.username !== undefined || this.configuration.password !== undefined)
    ) {
      headerParameters["Authorization"] =
        "Basic " + btoa(this.configuration.username + ":" + this.configuration.password);
    }
    const response = await this.request(
      {
        path: `/dek-registry/v1/keks`,
        method: "POST",
        headers: headerParameters,
        query: queryParameters,
        body: CreateKekRequestToJSON(requestParameters["CreateKekRequest"]),
      },
      initOverrides,
    );

    return new runtime.JSONApiResponse(response, (jsonValue) => KekFromJSON(jsonValue));
  }

  /**
   * Create a kek
   */
  async createKek(
    requestParameters: CreateKekOperationRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<Kek> {
    const response = await this.createKekRaw(requestParameters, initOverrides);
    return await response.value();
  }

  /**
   * Delete a kek
   */
  async deleteKekRaw(
    requestParameters: DeleteKekRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<runtime.ApiResponse<void>> {
    if (requestParameters["name"] == null) {
      throw new runtime.RequiredError(
        "name",
        'Required parameter "name" was null or undefined when calling deleteKek().',
      );
    }

    const queryParameters: any = {};

    if (requestParameters["permanent"] != null) {
      queryParameters["permanent"] = requestParameters["permanent"];
    }

    const headerParameters: runtime.HTTPHeaders = {};

    if (this.configuration && this.configuration.accessToken) {
      // oauth required
      headerParameters["Authorization"] = await this.configuration.accessToken(
        "external-access-token",
        [],
      );
    }

    if (
      this.configuration &&
      (this.configuration.username !== undefined || this.configuration.password !== undefined)
    ) {
      headerParameters["Authorization"] =
        "Basic " + btoa(this.configuration.username + ":" + this.configuration.password);
    }
    const response = await this.request(
      {
        path: `/dek-registry/v1/keks/{name}`.replace(
          `{${"name"}}`,
          encodeURIComponent(String(requestParameters["name"])),
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
   * Delete a kek
   */
  async deleteKek(
    requestParameters: DeleteKekRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<void> {
    await this.deleteKekRaw(requestParameters, initOverrides);
  }

  /**
   * Get a kek by name
   */
  async getKekRaw(
    requestParameters: GetKekRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<runtime.ApiResponse<Kek>> {
    if (requestParameters["name"] == null) {
      throw new runtime.RequiredError(
        "name",
        'Required parameter "name" was null or undefined when calling getKek().',
      );
    }

    const queryParameters: any = {};

    if (requestParameters["deleted"] != null) {
      queryParameters["deleted"] = requestParameters["deleted"];
    }

    const headerParameters: runtime.HTTPHeaders = {};

    if (this.configuration && this.configuration.accessToken) {
      // oauth required
      headerParameters["Authorization"] = await this.configuration.accessToken(
        "external-access-token",
        [],
      );
    }

    if (
      this.configuration &&
      (this.configuration.username !== undefined || this.configuration.password !== undefined)
    ) {
      headerParameters["Authorization"] =
        "Basic " + btoa(this.configuration.username + ":" + this.configuration.password);
    }
    const response = await this.request(
      {
        path: `/dek-registry/v1/keks/{name}`.replace(
          `{${"name"}}`,
          encodeURIComponent(String(requestParameters["name"])),
        ),
        method: "GET",
        headers: headerParameters,
        query: queryParameters,
      },
      initOverrides,
    );

    return new runtime.JSONApiResponse(response, (jsonValue) => KekFromJSON(jsonValue));
  }

  /**
   * Get a kek by name
   */
  async getKek(
    requestParameters: GetKekRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<Kek> {
    const response = await this.getKekRaw(requestParameters, initOverrides);
    return await response.value();
  }

  /**
   * Get a list of kek names
   */
  async getKekNamesRaw(
    requestParameters: GetKekNamesRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<runtime.ApiResponse<Array<string>>> {
    const queryParameters: any = {};

    if (requestParameters["deleted"] != null) {
      queryParameters["deleted"] = requestParameters["deleted"];
    }

    const headerParameters: runtime.HTTPHeaders = {};

    if (this.configuration && this.configuration.accessToken) {
      // oauth required
      headerParameters["Authorization"] = await this.configuration.accessToken(
        "external-access-token",
        [],
      );
    }

    if (
      this.configuration &&
      (this.configuration.username !== undefined || this.configuration.password !== undefined)
    ) {
      headerParameters["Authorization"] =
        "Basic " + btoa(this.configuration.username + ":" + this.configuration.password);
    }
    const response = await this.request(
      {
        path: `/dek-registry/v1/keks`,
        method: "GET",
        headers: headerParameters,
        query: queryParameters,
      },
      initOverrides,
    );

    return new runtime.JSONApiResponse<any>(response);
  }

  /**
   * Get a list of kek names
   */
  async getKekNames(
    requestParameters: GetKekNamesRequest = {},
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<Array<string>> {
    const response = await this.getKekNamesRaw(requestParameters, initOverrides);
    return await response.value();
  }

  /**
   * Alters a kek
   */
  async putKekRaw(
    requestParameters: PutKekRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<runtime.ApiResponse<Kek>> {
    if (requestParameters["name"] == null) {
      throw new runtime.RequiredError(
        "name",
        'Required parameter "name" was null or undefined when calling putKek().',
      );
    }

    if (requestParameters["UpdateKekRequest"] == null) {
      throw new runtime.RequiredError(
        "UpdateKekRequest",
        'Required parameter "UpdateKekRequest" was null or undefined when calling putKek().',
      );
    }

    const queryParameters: any = {};

    const headerParameters: runtime.HTTPHeaders = {};

    headerParameters["Content-Type"] = "application/vnd.schemaregistry.v1+json";

    if (this.configuration && this.configuration.accessToken) {
      // oauth required
      headerParameters["Authorization"] = await this.configuration.accessToken(
        "external-access-token",
        [],
      );
    }

    if (
      this.configuration &&
      (this.configuration.username !== undefined || this.configuration.password !== undefined)
    ) {
      headerParameters["Authorization"] =
        "Basic " + btoa(this.configuration.username + ":" + this.configuration.password);
    }
    const response = await this.request(
      {
        path: `/dek-registry/v1/keks/{name}`.replace(
          `{${"name"}}`,
          encodeURIComponent(String(requestParameters["name"])),
        ),
        method: "PUT",
        headers: headerParameters,
        query: queryParameters,
        body: UpdateKekRequestToJSON(requestParameters["UpdateKekRequest"]),
      },
      initOverrides,
    );

    return new runtime.JSONApiResponse(response, (jsonValue) => KekFromJSON(jsonValue));
  }

  /**
   * Alters a kek
   */
  async putKek(
    requestParameters: PutKekRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<Kek> {
    const response = await this.putKekRaw(requestParameters, initOverrides);
    return await response.value();
  }

  /**
   * Undelete a kek
   */
  async undeleteKekRaw(
    requestParameters: UndeleteKekRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<runtime.ApiResponse<void>> {
    if (requestParameters["name"] == null) {
      throw new runtime.RequiredError(
        "name",
        'Required parameter "name" was null or undefined when calling undeleteKek().',
      );
    }

    const queryParameters: any = {};

    const headerParameters: runtime.HTTPHeaders = {};

    if (this.configuration && this.configuration.accessToken) {
      // oauth required
      headerParameters["Authorization"] = await this.configuration.accessToken(
        "external-access-token",
        [],
      );
    }

    if (
      this.configuration &&
      (this.configuration.username !== undefined || this.configuration.password !== undefined)
    ) {
      headerParameters["Authorization"] =
        "Basic " + btoa(this.configuration.username + ":" + this.configuration.password);
    }
    const response = await this.request(
      {
        path: `/dek-registry/v1/keks/{name}/undelete`.replace(
          `{${"name"}}`,
          encodeURIComponent(String(requestParameters["name"])),
        ),
        method: "POST",
        headers: headerParameters,
        query: queryParameters,
      },
      initOverrides,
    );

    return new runtime.VoidApiResponse(response);
  }

  /**
   * Undelete a kek
   */
  async undeleteKek(
    requestParameters: UndeleteKekRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<void> {
    await this.undeleteKekRaw(requestParameters, initOverrides);
  }
}
