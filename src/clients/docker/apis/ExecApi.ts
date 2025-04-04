/* tslint:disable */
/* eslint-disable */
/**
 * Docker Engine API
 * The Engine API is an HTTP API served by Docker Engine. It is the API the Docker client uses to communicate with the Engine, so everything the Docker client can do can be done with the API.  Most of the client\'s commands map directly to API endpoints (e.g. `docker ps` is `GET /containers/json`). The notable exception is running containers, which consists of several API calls.  # Errors  The API uses standard HTTP status codes to indicate the success or failure of the API call. The body of the response will be JSON in the following format:  ``` {   \"message\": \"page not found\" } ```  # Versioning  The API is usually changed in each release, so API calls are versioned to ensure that clients don\'t break. To lock to a specific version of the API, you prefix the URL with its version, for example, call `/v1.30/info` to use the v1.30 version of the `/info` endpoint. If the API version specified in the URL is not supported by the daemon, a HTTP `400 Bad Request` error message is returned.  If you omit the version-prefix, the current version of the API (v1.43) is used. For example, calling `/info` is the same as calling `/v1.43/info`. Using the API without a version-prefix is deprecated and will be removed in a future release.  Engine releases in the near future should support this version of the API, so your client will continue to work even if it is talking to a newer Engine.  The API uses an open schema model, which means server may add extra properties to responses. Likewise, the server will ignore any extra query parameters and request body properties. When you write clients, you need to ignore additional properties in responses to ensure they do not break when talking to newer daemons.   # Authentication  Authentication for registries is handled client side. The client has to send authentication details to various endpoints that need to communicate with registries, such as `POST /images/(name)/push`. These are sent as `X-Registry-Auth` header as a [base64url encoded](https://tools.ietf.org/html/rfc4648#section-5) (JSON) string with the following structure:  ``` {   \"username\": \"string\",   \"password\": \"string\",   \"email\": \"string\",   \"serveraddress\": \"string\" } ```  The `serveraddress` is a domain/IP without a protocol. Throughout this structure, double quotes are required.  If you have already got an identity token from the [`/auth` endpoint](#operation/SystemAuth), you can just pass this instead of credentials:  ``` {   \"identitytoken\": \"9cbaf023786cd7...\" } ```
 *
 * The version of the OpenAPI document: 1.43
 *
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */

import * as runtime from "../runtime";
import type {
  ErrorResponse,
  ExecConfig,
  ExecInspectResponse,
  ExecStartConfig,
  IdResponse,
} from "../models/index";
import {
  ErrorResponseFromJSON,
  ErrorResponseToJSON,
  ExecConfigFromJSON,
  ExecConfigToJSON,
  ExecInspectResponseFromJSON,
  ExecInspectResponseToJSON,
  ExecStartConfigFromJSON,
  ExecStartConfigToJSON,
  IdResponseFromJSON,
  IdResponseToJSON,
} from "../models/index";

export interface ContainerExecRequest {
  id: string;
  execConfig: ExecConfig;
}

export interface ExecInspectRequest {
  id: string;
}

export interface ExecResizeRequest {
  id: string;
  h?: number;
  w?: number;
}

export interface ExecStartRequest {
  id: string;
  execStartConfig?: ExecStartConfig;
}

/**
 *
 */
export class ExecApi extends runtime.BaseAPI {
  /**
   * Run a command inside a running container.
   * Create an exec instance
   */
  async containerExecRaw(
    requestParameters: ContainerExecRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<runtime.ApiResponse<IdResponse>> {
    if (requestParameters["id"] == null) {
      throw new runtime.RequiredError(
        "id",
        'Required parameter "id" was null or undefined when calling containerExec().',
      );
    }

    if (requestParameters["execConfig"] == null) {
      throw new runtime.RequiredError(
        "execConfig",
        'Required parameter "execConfig" was null or undefined when calling containerExec().',
      );
    }

    const queryParameters: any = {};

    const headerParameters: runtime.HTTPHeaders = {};

    headerParameters["Content-Type"] = "application/json";

    const response = await this.request(
      {
        path: `/containers/{id}/exec`.replace(
          `{${"id"}}`,
          encodeURIComponent(String(requestParameters["id"])),
        ),
        method: "POST",
        headers: headerParameters,
        query: queryParameters,
        body: ExecConfigToJSON(requestParameters["execConfig"]),
      },
      initOverrides,
    );

    return new runtime.JSONApiResponse(response, (jsonValue) => IdResponseFromJSON(jsonValue));
  }

  /**
   * Run a command inside a running container.
   * Create an exec instance
   */
  async containerExec(
    requestParameters: ContainerExecRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<IdResponse> {
    const response = await this.containerExecRaw(requestParameters, initOverrides);
    return await response.value();
  }

  /**
   * Return low-level information about an exec instance.
   * Inspect an exec instance
   */
  async execInspectRaw(
    requestParameters: ExecInspectRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<runtime.ApiResponse<ExecInspectResponse>> {
    if (requestParameters["id"] == null) {
      throw new runtime.RequiredError(
        "id",
        'Required parameter "id" was null or undefined when calling execInspect().',
      );
    }

    const queryParameters: any = {};

    const headerParameters: runtime.HTTPHeaders = {};

    const response = await this.request(
      {
        path: `/exec/{id}/json`.replace(
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
      ExecInspectResponseFromJSON(jsonValue),
    );
  }

  /**
   * Return low-level information about an exec instance.
   * Inspect an exec instance
   */
  async execInspect(
    requestParameters: ExecInspectRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<ExecInspectResponse> {
    const response = await this.execInspectRaw(requestParameters, initOverrides);
    return await response.value();
  }

  /**
   * Resize the TTY session used by an exec instance. This endpoint only works if `tty` was specified as part of creating and starting the exec instance.
   * Resize an exec instance
   */
  async execResizeRaw(
    requestParameters: ExecResizeRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<runtime.ApiResponse<void>> {
    if (requestParameters["id"] == null) {
      throw new runtime.RequiredError(
        "id",
        'Required parameter "id" was null or undefined when calling execResize().',
      );
    }

    const queryParameters: any = {};

    if (requestParameters["h"] != null) {
      queryParameters["h"] = requestParameters["h"];
    }

    if (requestParameters["w"] != null) {
      queryParameters["w"] = requestParameters["w"];
    }

    const headerParameters: runtime.HTTPHeaders = {};

    const response = await this.request(
      {
        path: `/exec/{id}/resize`.replace(
          `{${"id"}}`,
          encodeURIComponent(String(requestParameters["id"])),
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
   * Resize the TTY session used by an exec instance. This endpoint only works if `tty` was specified as part of creating and starting the exec instance.
   * Resize an exec instance
   */
  async execResize(
    requestParameters: ExecResizeRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<void> {
    await this.execResizeRaw(requestParameters, initOverrides);
  }

  /**
   * Starts a previously set up exec instance. If detach is true, this endpoint returns immediately after starting the command. Otherwise, it sets up an interactive session with the command.
   * Start an exec instance
   */
  async execStartRaw(
    requestParameters: ExecStartRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<runtime.ApiResponse<void>> {
    if (requestParameters["id"] == null) {
      throw new runtime.RequiredError(
        "id",
        'Required parameter "id" was null or undefined when calling execStart().',
      );
    }

    const queryParameters: any = {};

    const headerParameters: runtime.HTTPHeaders = {};

    headerParameters["Content-Type"] = "application/json";

    const response = await this.request(
      {
        path: `/exec/{id}/start`.replace(
          `{${"id"}}`,
          encodeURIComponent(String(requestParameters["id"])),
        ),
        method: "POST",
        headers: headerParameters,
        query: queryParameters,
        body: ExecStartConfigToJSON(requestParameters["execStartConfig"]),
      },
      initOverrides,
    );

    return new runtime.VoidApiResponse(response);
  }

  /**
   * Starts a previously set up exec instance. If detach is true, this endpoint returns immediately after starting the command. Otherwise, it sets up an interactive session with the command.
   * Start an exec instance
   */
  async execStart(
    requestParameters: ExecStartRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<void> {
    await this.execStartRaw(requestParameters, initOverrides);
  }
}
