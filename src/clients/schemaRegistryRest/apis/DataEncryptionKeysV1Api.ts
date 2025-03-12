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
import type { CreateDekRequest, Dek } from "../models/index";
import {
  CreateDekRequestFromJSON,
  CreateDekRequestToJSON,
  DekFromJSON,
  DekToJSON,
} from "../models/index";

export interface CreateDekOperationRequest {
  name: string;
  CreateDekRequest: CreateDekRequest;
}

export interface DeleteDekVersionRequest {
  name: string;
  subject: string;
  version: string;
  algorithm?: DeleteDekVersionAlgorithmEnum;
  permanent?: boolean;
}

export interface DeleteDekVersionsRequest {
  name: string;
  subject: string;
  algorithm?: DeleteDekVersionsAlgorithmEnum;
  permanent?: boolean;
}

export interface GetDekRequest {
  name: string;
  subject: string;
  algorithm?: GetDekAlgorithmEnum;
  deleted?: boolean;
}

export interface GetDekByVersionRequest {
  name: string;
  subject: string;
  version: string;
  algorithm?: GetDekByVersionAlgorithmEnum;
  deleted?: boolean;
}

export interface GetDekSubjectsRequest {
  name: string;
  deleted?: boolean;
}

export interface GetDekVersionsRequest {
  name: string;
  subject: string;
  algorithm?: GetDekVersionsAlgorithmEnum;
  deleted?: boolean;
}

export interface UndeleteDekVersionRequest {
  name: string;
  subject: string;
  version: string;
  algorithm?: UndeleteDekVersionAlgorithmEnum;
}

export interface UndeleteDekVersionsRequest {
  name: string;
  subject: string;
  algorithm?: UndeleteDekVersionsAlgorithmEnum;
}

/**
 *
 */
export class DataEncryptionKeysV1Api extends runtime.BaseAPI {
  /**
   * Create a dek
   */
  async createDekRaw(
    requestParameters: CreateDekOperationRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<runtime.ApiResponse<Dek>> {
    if (requestParameters["name"] == null) {
      throw new runtime.RequiredError(
        "name",
        'Required parameter "name" was null or undefined when calling createDek().',
      );
    }

    if (requestParameters["CreateDekRequest"] == null) {
      throw new runtime.RequiredError(
        "CreateDekRequest",
        'Required parameter "CreateDekRequest" was null or undefined when calling createDek().',
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
        path: `/dek-registry/v1/keks/{name}/deks`.replace(
          `{${"name"}}`,
          encodeURIComponent(String(requestParameters["name"])),
        ),
        method: "POST",
        headers: headerParameters,
        query: queryParameters,
        body: CreateDekRequestToJSON(requestParameters["CreateDekRequest"]),
      },
      initOverrides,
    );

    return new runtime.JSONApiResponse(response, (jsonValue) => DekFromJSON(jsonValue));
  }

  /**
   * Create a dek
   */
  async createDek(
    requestParameters: CreateDekOperationRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<Dek> {
    const response = await this.createDekRaw(requestParameters, initOverrides);
    return await response.value();
  }

  /**
   * Delete a dek version
   */
  async deleteDekVersionRaw(
    requestParameters: DeleteDekVersionRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<runtime.ApiResponse<void>> {
    if (requestParameters["name"] == null) {
      throw new runtime.RequiredError(
        "name",
        'Required parameter "name" was null or undefined when calling deleteDekVersion().',
      );
    }

    if (requestParameters["subject"] == null) {
      throw new runtime.RequiredError(
        "subject",
        'Required parameter "subject" was null or undefined when calling deleteDekVersion().',
      );
    }

    if (requestParameters["version"] == null) {
      throw new runtime.RequiredError(
        "version",
        'Required parameter "version" was null or undefined when calling deleteDekVersion().',
      );
    }

    const queryParameters: any = {};

    if (requestParameters["algorithm"] != null) {
      queryParameters["algorithm"] = requestParameters["algorithm"];
    }

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
        path: `/dek-registry/v1/keks/{name}/deks/{subject}/versions/{version}`
          .replace(`{${"name"}}`, encodeURIComponent(String(requestParameters["name"])))
          .replace(`{${"subject"}}`, encodeURIComponent(String(requestParameters["subject"])))
          .replace(`{${"version"}}`, encodeURIComponent(String(requestParameters["version"]))),
        method: "DELETE",
        headers: headerParameters,
        query: queryParameters,
      },
      initOverrides,
    );

    return new runtime.VoidApiResponse(response);
  }

  /**
   * Delete a dek version
   */
  async deleteDekVersion(
    requestParameters: DeleteDekVersionRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<void> {
    await this.deleteDekVersionRaw(requestParameters, initOverrides);
  }

  /**
   * Delete all versions of a dek
   */
  async deleteDekVersionsRaw(
    requestParameters: DeleteDekVersionsRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<runtime.ApiResponse<void>> {
    if (requestParameters["name"] == null) {
      throw new runtime.RequiredError(
        "name",
        'Required parameter "name" was null or undefined when calling deleteDekVersions().',
      );
    }

    if (requestParameters["subject"] == null) {
      throw new runtime.RequiredError(
        "subject",
        'Required parameter "subject" was null or undefined when calling deleteDekVersions().',
      );
    }

    const queryParameters: any = {};

    if (requestParameters["algorithm"] != null) {
      queryParameters["algorithm"] = requestParameters["algorithm"];
    }

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
        path: `/dek-registry/v1/keks/{name}/deks/{subject}`
          .replace(`{${"name"}}`, encodeURIComponent(String(requestParameters["name"])))
          .replace(`{${"subject"}}`, encodeURIComponent(String(requestParameters["subject"]))),
        method: "DELETE",
        headers: headerParameters,
        query: queryParameters,
      },
      initOverrides,
    );

    return new runtime.VoidApiResponse(response);
  }

  /**
   * Delete all versions of a dek
   */
  async deleteDekVersions(
    requestParameters: DeleteDekVersionsRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<void> {
    await this.deleteDekVersionsRaw(requestParameters, initOverrides);
  }

  /**
   * Get a dek by subject
   */
  async getDekRaw(
    requestParameters: GetDekRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<runtime.ApiResponse<Dek>> {
    if (requestParameters["name"] == null) {
      throw new runtime.RequiredError(
        "name",
        'Required parameter "name" was null or undefined when calling getDek().',
      );
    }

    if (requestParameters["subject"] == null) {
      throw new runtime.RequiredError(
        "subject",
        'Required parameter "subject" was null or undefined when calling getDek().',
      );
    }

    const queryParameters: any = {};

    if (requestParameters["algorithm"] != null) {
      queryParameters["algorithm"] = requestParameters["algorithm"];
    }

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
        path: `/dek-registry/v1/keks/{name}/deks/{subject}`
          .replace(`{${"name"}}`, encodeURIComponent(String(requestParameters["name"])))
          .replace(`{${"subject"}}`, encodeURIComponent(String(requestParameters["subject"]))),
        method: "GET",
        headers: headerParameters,
        query: queryParameters,
      },
      initOverrides,
    );

    return new runtime.JSONApiResponse(response, (jsonValue) => DekFromJSON(jsonValue));
  }

  /**
   * Get a dek by subject
   */
  async getDek(
    requestParameters: GetDekRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<Dek> {
    const response = await this.getDekRaw(requestParameters, initOverrides);
    return await response.value();
  }

  /**
   * Get a dek by subject and version
   */
  async getDekByVersionRaw(
    requestParameters: GetDekByVersionRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<runtime.ApiResponse<Dek>> {
    if (requestParameters["name"] == null) {
      throw new runtime.RequiredError(
        "name",
        'Required parameter "name" was null or undefined when calling getDekByVersion().',
      );
    }

    if (requestParameters["subject"] == null) {
      throw new runtime.RequiredError(
        "subject",
        'Required parameter "subject" was null or undefined when calling getDekByVersion().',
      );
    }

    if (requestParameters["version"] == null) {
      throw new runtime.RequiredError(
        "version",
        'Required parameter "version" was null or undefined when calling getDekByVersion().',
      );
    }

    const queryParameters: any = {};

    if (requestParameters["algorithm"] != null) {
      queryParameters["algorithm"] = requestParameters["algorithm"];
    }

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
        path: `/dek-registry/v1/keks/{name}/deks/{subject}/versions/{version}`
          .replace(`{${"name"}}`, encodeURIComponent(String(requestParameters["name"])))
          .replace(`{${"subject"}}`, encodeURIComponent(String(requestParameters["subject"])))
          .replace(`{${"version"}}`, encodeURIComponent(String(requestParameters["version"]))),
        method: "GET",
        headers: headerParameters,
        query: queryParameters,
      },
      initOverrides,
    );

    return new runtime.JSONApiResponse(response, (jsonValue) => DekFromJSON(jsonValue));
  }

  /**
   * Get a dek by subject and version
   */
  async getDekByVersion(
    requestParameters: GetDekByVersionRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<Dek> {
    const response = await this.getDekByVersionRaw(requestParameters, initOverrides);
    return await response.value();
  }

  /**
   * Get a list of dek subjects
   */
  async getDekSubjectsRaw(
    requestParameters: GetDekSubjectsRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<runtime.ApiResponse<Array<string>>> {
    if (requestParameters["name"] == null) {
      throw new runtime.RequiredError(
        "name",
        'Required parameter "name" was null or undefined when calling getDekSubjects().',
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
        path: `/dek-registry/v1/keks/{name}/deks`.replace(
          `{${"name"}}`,
          encodeURIComponent(String(requestParameters["name"])),
        ),
        method: "GET",
        headers: headerParameters,
        query: queryParameters,
      },
      initOverrides,
    );

    return new runtime.JSONApiResponse<any>(response);
  }

  /**
   * Get a list of dek subjects
   */
  async getDekSubjects(
    requestParameters: GetDekSubjectsRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<Array<string>> {
    const response = await this.getDekSubjectsRaw(requestParameters, initOverrides);
    return await response.value();
  }

  /**
   * List versions of dek
   */
  async getDekVersionsRaw(
    requestParameters: GetDekVersionsRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<runtime.ApiResponse<Array<number>>> {
    if (requestParameters["name"] == null) {
      throw new runtime.RequiredError(
        "name",
        'Required parameter "name" was null or undefined when calling getDekVersions().',
      );
    }

    if (requestParameters["subject"] == null) {
      throw new runtime.RequiredError(
        "subject",
        'Required parameter "subject" was null or undefined when calling getDekVersions().',
      );
    }

    const queryParameters: any = {};

    if (requestParameters["algorithm"] != null) {
      queryParameters["algorithm"] = requestParameters["algorithm"];
    }

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
        path: `/dek-registry/v1/keks/{name}/deks/{subject}/versions`
          .replace(`{${"name"}}`, encodeURIComponent(String(requestParameters["name"])))
          .replace(`{${"subject"}}`, encodeURIComponent(String(requestParameters["subject"]))),
        method: "GET",
        headers: headerParameters,
        query: queryParameters,
      },
      initOverrides,
    );

    return new runtime.JSONApiResponse<any>(response);
  }

  /**
   * List versions of dek
   */
  async getDekVersions(
    requestParameters: GetDekVersionsRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<Array<number>> {
    const response = await this.getDekVersionsRaw(requestParameters, initOverrides);
    return await response.value();
  }

  /**
   * Undelete a dek version
   */
  async undeleteDekVersionRaw(
    requestParameters: UndeleteDekVersionRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<runtime.ApiResponse<void>> {
    if (requestParameters["name"] == null) {
      throw new runtime.RequiredError(
        "name",
        'Required parameter "name" was null or undefined when calling undeleteDekVersion().',
      );
    }

    if (requestParameters["subject"] == null) {
      throw new runtime.RequiredError(
        "subject",
        'Required parameter "subject" was null or undefined when calling undeleteDekVersion().',
      );
    }

    if (requestParameters["version"] == null) {
      throw new runtime.RequiredError(
        "version",
        'Required parameter "version" was null or undefined when calling undeleteDekVersion().',
      );
    }

    const queryParameters: any = {};

    if (requestParameters["algorithm"] != null) {
      queryParameters["algorithm"] = requestParameters["algorithm"];
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
        path: `/dek-registry/v1/keks/{name}/deks/{subject}/versions/{version}/undelete`
          .replace(`{${"name"}}`, encodeURIComponent(String(requestParameters["name"])))
          .replace(`{${"subject"}}`, encodeURIComponent(String(requestParameters["subject"])))
          .replace(`{${"version"}}`, encodeURIComponent(String(requestParameters["version"]))),
        method: "POST",
        headers: headerParameters,
        query: queryParameters,
      },
      initOverrides,
    );

    return new runtime.VoidApiResponse(response);
  }

  /**
   * Undelete a dek version
   */
  async undeleteDekVersion(
    requestParameters: UndeleteDekVersionRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<void> {
    await this.undeleteDekVersionRaw(requestParameters, initOverrides);
  }

  /**
   * Undelete all versions of a dek
   */
  async undeleteDekVersionsRaw(
    requestParameters: UndeleteDekVersionsRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<runtime.ApiResponse<void>> {
    if (requestParameters["name"] == null) {
      throw new runtime.RequiredError(
        "name",
        'Required parameter "name" was null or undefined when calling undeleteDekVersions().',
      );
    }

    if (requestParameters["subject"] == null) {
      throw new runtime.RequiredError(
        "subject",
        'Required parameter "subject" was null or undefined when calling undeleteDekVersions().',
      );
    }

    const queryParameters: any = {};

    if (requestParameters["algorithm"] != null) {
      queryParameters["algorithm"] = requestParameters["algorithm"];
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
        path: `/dek-registry/v1/keks/{name}/deks/{subject}/undelete`
          .replace(`{${"name"}}`, encodeURIComponent(String(requestParameters["name"])))
          .replace(`{${"subject"}}`, encodeURIComponent(String(requestParameters["subject"]))),
        method: "POST",
        headers: headerParameters,
        query: queryParameters,
      },
      initOverrides,
    );

    return new runtime.VoidApiResponse(response);
  }

  /**
   * Undelete all versions of a dek
   */
  async undeleteDekVersions(
    requestParameters: UndeleteDekVersionsRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<void> {
    await this.undeleteDekVersionsRaw(requestParameters, initOverrides);
  }
}

/**
 * @export
 * @enum {string}
 */
export enum DeleteDekVersionAlgorithmEnum {
  Aes128Gcm = "AES128_GCM",
  Aes256Gcm = "AES256_GCM",
  Aes256Siv = "AES256_SIV",
}
/**
 * @export
 * @enum {string}
 */
export enum DeleteDekVersionsAlgorithmEnum {
  Aes128Gcm = "AES128_GCM",
  Aes256Gcm = "AES256_GCM",
  Aes256Siv = "AES256_SIV",
}
/**
 * @export
 * @enum {string}
 */
export enum GetDekAlgorithmEnum {
  Aes128Gcm = "AES128_GCM",
  Aes256Gcm = "AES256_GCM",
  Aes256Siv = "AES256_SIV",
}
/**
 * @export
 * @enum {string}
 */
export enum GetDekByVersionAlgorithmEnum {
  Aes128Gcm = "AES128_GCM",
  Aes256Gcm = "AES256_GCM",
  Aes256Siv = "AES256_SIV",
}
/**
 * @export
 * @enum {string}
 */
export enum GetDekVersionsAlgorithmEnum {
  Aes128Gcm = "AES128_GCM",
  Aes256Gcm = "AES256_GCM",
  Aes256Siv = "AES256_SIV",
}
/**
 * @export
 * @enum {string}
 */
export enum UndeleteDekVersionAlgorithmEnum {
  Aes128Gcm = "AES128_GCM",
  Aes256Gcm = "AES256_GCM",
  Aes256Siv = "AES256_SIV",
}
/**
 * @export
 * @enum {string}
 */
export enum UndeleteDekVersionsAlgorithmEnum {
  Aes128Gcm = "AES128_GCM",
  Aes256Gcm = "AES256_GCM",
  Aes256Siv = "AES256_SIV",
}
