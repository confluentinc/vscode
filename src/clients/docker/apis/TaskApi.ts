/* tslint:disable */
/* eslint-disable */
/**
 * Docker Engine API
 * The Engine API is an HTTP API served by Docker Engine. It is the API the Docker client uses to communicate with the Engine, so everything the Docker client can do can be done with the API.  Most of the client\'s commands map directly to API endpoints (e.g. `docker ps` is `GET /containers/json`). The notable exception is running containers, which consists of several API calls.  # Errors  The API uses standard HTTP status codes to indicate the success or failure of the API call. The body of the response will be JSON in the following format:  ``` {   \"message\": \"page not found\" } ```  # Versioning  The API is usually changed in each release, so API calls are versioned to ensure that clients don\'t break. To lock to a specific version of the API, you prefix the URL with its version, for example, call `/v1.30/info` to use the v1.30 version of the `/info` endpoint. If the API version specified in the URL is not supported by the daemon, a HTTP `400 Bad Request` error message is returned.  If you omit the version-prefix, the current version of the API (v1.47) is used. For example, calling `/info` is the same as calling `/v1.47/info`. Using the API without a version-prefix is deprecated and will be removed in a future release.  Engine releases in the near future should support this version of the API, so your client will continue to work even if it is talking to a newer Engine.  The API uses an open schema model, which means server may add extra properties to responses. Likewise, the server will ignore any extra query parameters and request body properties. When you write clients, you need to ignore additional properties in responses to ensure they do not break when talking to newer daemons.   # Authentication  Authentication for registries is handled client side. The client has to send authentication details to various endpoints that need to communicate with registries, such as `POST /images/(name)/push`. These are sent as `X-Registry-Auth` header as a [base64url encoded](https://tools.ietf.org/html/rfc4648#section-5) (JSON) string with the following structure:  ``` {   \"username\": \"string\",   \"password\": \"string\",   \"email\": \"string\",   \"serveraddress\": \"string\" } ```  The `serveraddress` is a domain/IP without a protocol. Throughout this structure, double quotes are required.  If you have already got an identity token from the [`/auth` endpoint](#operation/SystemAuth), you can just pass this instead of credentials:  ``` {   \"identitytoken\": \"9cbaf023786cd7...\" } ```
 *
 * The version of the OpenAPI document: 1.47
 *
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */

import * as runtime from "../runtime";
import type { ErrorResponse, Task } from "../models/index";
import {
  ErrorResponseFromJSON,
  ErrorResponseToJSON,
  TaskFromJSON,
  TaskToJSON,
} from "../models/index";

export interface TaskInspectRequest {
  id: string;
}

export interface TaskListRequest {
  filters?: string;
}

export interface TaskLogsRequest {
  id: string;
  details?: boolean;
  follow?: boolean;
  stdout?: boolean;
  stderr?: boolean;
  since?: number;
  timestamps?: boolean;
  tail?: string;
}

/**
 *
 */
export class TaskApi extends runtime.BaseAPI {
  /**
   * Inspect a task
   */
  async taskInspectRaw(
    requestParameters: TaskInspectRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<runtime.ApiResponse<Task>> {
    if (requestParameters["id"] == null) {
      throw new runtime.RequiredError(
        "id",
        'Required parameter "id" was null or undefined when calling taskInspect().',
      );
    }

    const queryParameters: any = {};

    const headerParameters: runtime.HTTPHeaders = {};

    const response = await this.request(
      {
        path: `/tasks/{id}`.replace(
          `{${"id"}}`,
          encodeURIComponent(String(requestParameters["id"])),
        ),
        method: "GET",
        headers: headerParameters,
        query: queryParameters,
      },
      initOverrides,
    );

    return new runtime.JSONApiResponse(response, (jsonValue) => TaskFromJSON(jsonValue));
  }

  /**
   * Inspect a task
   */
  async taskInspect(
    requestParameters: TaskInspectRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<Task> {
    const response = await this.taskInspectRaw(requestParameters, initOverrides);
    return await response.value();
  }

  /**
   * List tasks
   */
  async taskListRaw(
    requestParameters: TaskListRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<runtime.ApiResponse<Array<Task>>> {
    const queryParameters: any = {};

    if (requestParameters["filters"] != null) {
      queryParameters["filters"] = requestParameters["filters"];
    }

    const headerParameters: runtime.HTTPHeaders = {};

    const response = await this.request(
      {
        path: `/tasks`,
        method: "GET",
        headers: headerParameters,
        query: queryParameters,
      },
      initOverrides,
    );

    return new runtime.JSONApiResponse(response, (jsonValue) => jsonValue.map(TaskFromJSON));
  }

  /**
   * List tasks
   */
  async taskList(
    requestParameters: TaskListRequest = {},
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<Array<Task>> {
    const response = await this.taskListRaw(requestParameters, initOverrides);
    return await response.value();
  }

  /**
   * Get `stdout` and `stderr` logs from a task. See also [`/containers/{id}/logs`](#operation/ContainerLogs).  **Note**: This endpoint works only for services with the `local`, `json-file` or `journald` logging drivers.
   * Get task logs
   */
  async taskLogsRaw(
    requestParameters: TaskLogsRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<runtime.ApiResponse<Blob>> {
    if (requestParameters["id"] == null) {
      throw new runtime.RequiredError(
        "id",
        'Required parameter "id" was null or undefined when calling taskLogs().',
      );
    }

    const queryParameters: any = {};

    if (requestParameters["details"] != null) {
      queryParameters["details"] = requestParameters["details"];
    }

    if (requestParameters["follow"] != null) {
      queryParameters["follow"] = requestParameters["follow"];
    }

    if (requestParameters["stdout"] != null) {
      queryParameters["stdout"] = requestParameters["stdout"];
    }

    if (requestParameters["stderr"] != null) {
      queryParameters["stderr"] = requestParameters["stderr"];
    }

    if (requestParameters["since"] != null) {
      queryParameters["since"] = requestParameters["since"];
    }

    if (requestParameters["timestamps"] != null) {
      queryParameters["timestamps"] = requestParameters["timestamps"];
    }

    if (requestParameters["tail"] != null) {
      queryParameters["tail"] = requestParameters["tail"];
    }

    const headerParameters: runtime.HTTPHeaders = {};

    const response = await this.request(
      {
        path: `/tasks/{id}/logs`.replace(
          `{${"id"}}`,
          encodeURIComponent(String(requestParameters["id"])),
        ),
        method: "GET",
        headers: headerParameters,
        query: queryParameters,
      },
      initOverrides,
    );

    return new runtime.BlobApiResponse(response);
  }

  /**
   * Get `stdout` and `stderr` logs from a task. See also [`/containers/{id}/logs`](#operation/ContainerLogs).  **Note**: This endpoint works only for services with the `local`, `json-file` or `journald` logging drivers.
   * Get task logs
   */
  async taskLogs(
    requestParameters: TaskLogsRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<Blob> {
    const response = await this.taskLogsRaw(requestParameters, initOverrides);
    return await response.value();
  }
}
