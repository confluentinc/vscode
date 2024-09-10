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
import type { ClusterConfig, Config, ConfigUpdateRequest, ErrorMessage } from "../models/index";
import {
  ClusterConfigFromJSON,
  ClusterConfigToJSON,
  ConfigFromJSON,
  ConfigToJSON,
  ConfigUpdateRequestFromJSON,
  ConfigUpdateRequestToJSON,
  ErrorMessageFromJSON,
  ErrorMessageToJSON,
} from "../models/index";

export interface DeleteSubjectConfigRequest {
  subject: string;
}

export interface GetSubjectLevelConfigRequest {
  subject: string;
  defaultToGlobal?: boolean;
}

export interface UpdateSubjectLevelConfigRequest {
  subject: string;
  ConfigUpdateRequest: ConfigUpdateRequest;
}

export interface UpdateTopLevelConfigRequest {
  ConfigUpdateRequest: ConfigUpdateRequest;
}

/**
 *
 */
export class ConfigV1Api extends runtime.BaseAPI {
  /**
   * Deletes the specified subject-level compatibility level config and reverts to the global default.
   * Delete subject compatibility level
   */
  async deleteSubjectConfigRaw(
    requestParameters: DeleteSubjectConfigRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<runtime.ApiResponse<string>> {
    if (requestParameters["subject"] == null) {
      throw new runtime.RequiredError(
        "subject",
        'Required parameter "subject" was null or undefined when calling deleteSubjectConfig().',
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
        path: `/config/{subject}`.replace(
          `{${"subject"}}`,
          encodeURIComponent(String(requestParameters["subject"])),
        ),
        method: "DELETE",
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
   * Deletes the specified subject-level compatibility level config and reverts to the global default.
   * Delete subject compatibility level
   */
  async deleteSubjectConfig(
    requestParameters: DeleteSubjectConfigRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<string> {
    const response = await this.deleteSubjectConfigRaw(requestParameters, initOverrides);
    return await response.value();
  }

  /**
   * Deletes the global compatibility level config and reverts to the default.
   * Delete global compatibility level
   */
  async deleteTopLevelConfigRaw(
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<runtime.ApiResponse<string>> {
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
        path: `/config`,
        method: "DELETE",
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
   * Deletes the global compatibility level config and reverts to the default.
   * Delete global compatibility level
   */
  async deleteTopLevelConfig(
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<string> {
    const response = await this.deleteTopLevelConfigRaw(initOverrides);
    return await response.value();
  }

  /**
   * Retrieves cluster config information.
   * Get cluster config
   */
  async getClusterConfigRaw(
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<runtime.ApiResponse<ClusterConfig>> {
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
        path: `/clusterconfig`,
        method: "GET",
        headers: headerParameters,
        query: queryParameters,
      },
      initOverrides,
    );

    return new runtime.JSONApiResponse(response, (jsonValue) => ClusterConfigFromJSON(jsonValue));
  }

  /**
   * Retrieves cluster config information.
   * Get cluster config
   */
  async getClusterConfig(
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<ClusterConfig> {
    const response = await this.getClusterConfigRaw(initOverrides);
    return await response.value();
  }

  /**
   * Retrieves compatibility level, compatibility group, normalization, default metadata, and rule set for a subject.
   * Get subject compatibility level
   */
  async getSubjectLevelConfigRaw(
    requestParameters: GetSubjectLevelConfigRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<runtime.ApiResponse<Config>> {
    if (requestParameters["subject"] == null) {
      throw new runtime.RequiredError(
        "subject",
        'Required parameter "subject" was null or undefined when calling getSubjectLevelConfig().',
      );
    }

    const queryParameters: any = {};

    if (requestParameters["defaultToGlobal"] != null) {
      queryParameters["defaultToGlobal"] = requestParameters["defaultToGlobal"];
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
        path: `/config/{subject}`.replace(
          `{${"subject"}}`,
          encodeURIComponent(String(requestParameters["subject"])),
        ),
        method: "GET",
        headers: headerParameters,
        query: queryParameters,
      },
      initOverrides,
    );

    return new runtime.JSONApiResponse(response, (jsonValue) => ConfigFromJSON(jsonValue));
  }

  /**
   * Retrieves compatibility level, compatibility group, normalization, default metadata, and rule set for a subject.
   * Get subject compatibility level
   */
  async getSubjectLevelConfig(
    requestParameters: GetSubjectLevelConfigRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<Config> {
    const response = await this.getSubjectLevelConfigRaw(requestParameters, initOverrides);
    return await response.value();
  }

  /**
   * Retrieves the global compatibility level, compatibility group, normalization, default metadata, and rule set.
   * Get global compatibility level
   */
  async getTopLevelConfigRaw(
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<runtime.ApiResponse<Config>> {
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
        path: `/config`,
        method: "GET",
        headers: headerParameters,
        query: queryParameters,
      },
      initOverrides,
    );

    return new runtime.JSONApiResponse(response, (jsonValue) => ConfigFromJSON(jsonValue));
  }

  /**
   * Retrieves the global compatibility level, compatibility group, normalization, default metadata, and rule set.
   * Get global compatibility level
   */
  async getTopLevelConfig(
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<Config> {
    const response = await this.getTopLevelConfigRaw(initOverrides);
    return await response.value();
  }

  /**
   * Update compatibility level, compatibility group, normalization, default metadata, and rule set for the specified subject. On success, echoes the original request back to the client.
   * Update subject compatibility level
   */
  async updateSubjectLevelConfigRaw(
    requestParameters: UpdateSubjectLevelConfigRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<runtime.ApiResponse<ConfigUpdateRequest>> {
    if (requestParameters["subject"] == null) {
      throw new runtime.RequiredError(
        "subject",
        'Required parameter "subject" was null or undefined when calling updateSubjectLevelConfig().',
      );
    }

    if (requestParameters["ConfigUpdateRequest"] == null) {
      throw new runtime.RequiredError(
        "ConfigUpdateRequest",
        'Required parameter "ConfigUpdateRequest" was null or undefined when calling updateSubjectLevelConfig().',
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
        path: `/config/{subject}`.replace(
          `{${"subject"}}`,
          encodeURIComponent(String(requestParameters["subject"])),
        ),
        method: "PUT",
        headers: headerParameters,
        query: queryParameters,
        body: ConfigUpdateRequestToJSON(requestParameters["ConfigUpdateRequest"]),
      },
      initOverrides,
    );

    return new runtime.JSONApiResponse(response, (jsonValue) =>
      ConfigUpdateRequestFromJSON(jsonValue),
    );
  }

  /**
   * Update compatibility level, compatibility group, normalization, default metadata, and rule set for the specified subject. On success, echoes the original request back to the client.
   * Update subject compatibility level
   */
  async updateSubjectLevelConfig(
    requestParameters: UpdateSubjectLevelConfigRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<ConfigUpdateRequest> {
    const response = await this.updateSubjectLevelConfigRaw(requestParameters, initOverrides);
    return await response.value();
  }

  /**
   * Updates the global compatibility level, compatibility group, schema normalization, default metadata, and rule set. On success, echoes the original request back to the client.
   * Update global compatibility level
   */
  async updateTopLevelConfigRaw(
    requestParameters: UpdateTopLevelConfigRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<runtime.ApiResponse<ConfigUpdateRequest>> {
    if (requestParameters["ConfigUpdateRequest"] == null) {
      throw new runtime.RequiredError(
        "ConfigUpdateRequest",
        'Required parameter "ConfigUpdateRequest" was null or undefined when calling updateTopLevelConfig().',
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
        path: `/config`,
        method: "PUT",
        headers: headerParameters,
        query: queryParameters,
        body: ConfigUpdateRequestToJSON(requestParameters["ConfigUpdateRequest"]),
      },
      initOverrides,
    );

    return new runtime.JSONApiResponse(response, (jsonValue) =>
      ConfigUpdateRequestFromJSON(jsonValue),
    );
  }

  /**
   * Updates the global compatibility level, compatibility group, schema normalization, default metadata, and rule set. On success, echoes the original request back to the client.
   * Update global compatibility level
   */
  async updateTopLevelConfig(
    requestParameters: UpdateTopLevelConfigRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<ConfigUpdateRequest> {
    const response = await this.updateTopLevelConfigRaw(requestParameters, initOverrides);
    return await response.value();
  }
}
