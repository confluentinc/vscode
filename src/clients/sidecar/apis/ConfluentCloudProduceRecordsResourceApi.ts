/* tslint:disable */
/* eslint-disable */
/**
 * Confluent ide-sidecar API
 * API for the Confluent ide-sidecar, part of Confluent for VS Code
 *
 * The version of the OpenAPI document: 0.184.0
 * Contact: vscode@confluent.io
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */

import * as runtime from "../runtime";
import type { ProduceRequest, ProduceResponse } from "../models/index";
import {
  ProduceRequestFromJSON,
  ProduceRequestToJSON,
  ProduceResponseFromJSON,
  ProduceResponseToJSON,
} from "../models/index";

export interface GatewayV1ClustersClusterIdTopicsTopicNameRecordsPostRequest {
  cluster_id: string;
  topic_name: string;
  x_connection_id: string;
  dry_run?: boolean;
  ProduceRequest?: ProduceRequest;
}

/**
 *
 */
export class ConfluentCloudProduceRecordsResourceApi extends runtime.BaseAPI {
  /**
   */
  async gatewayV1ClustersClusterIdTopicsTopicNameRecordsPostRaw(
    requestParameters: GatewayV1ClustersClusterIdTopicsTopicNameRecordsPostRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<runtime.ApiResponse<ProduceResponse>> {
    if (requestParameters["cluster_id"] == null) {
      throw new runtime.RequiredError(
        "cluster_id",
        'Required parameter "cluster_id" was null or undefined when calling gatewayV1ClustersClusterIdTopicsTopicNameRecordsPost().',
      );
    }

    if (requestParameters["topic_name"] == null) {
      throw new runtime.RequiredError(
        "topic_name",
        'Required parameter "topic_name" was null or undefined when calling gatewayV1ClustersClusterIdTopicsTopicNameRecordsPost().',
      );
    }

    if (requestParameters["x_connection_id"] == null) {
      throw new runtime.RequiredError(
        "x_connection_id",
        'Required parameter "x_connection_id" was null or undefined when calling gatewayV1ClustersClusterIdTopicsTopicNameRecordsPost().',
      );
    }

    const queryParameters: any = {};

    if (requestParameters["dry_run"] != null) {
      queryParameters["dry_run"] = requestParameters["dry_run"];
    }

    const headerParameters: runtime.HTTPHeaders = {};

    headerParameters["Content-Type"] = "application/json";

    if (requestParameters["x_connection_id"] != null) {
      headerParameters["x-connection-id"] = String(requestParameters["x_connection_id"]);
    }

    const response = await this.request(
      {
        path: `/gateway/v1/clusters/{cluster_id}/topics/{topic_name}/records`
          .replace(`{${"cluster_id"}}`, encodeURIComponent(String(requestParameters["cluster_id"])))
          .replace(
            `{${"topic_name"}}`,
            encodeURIComponent(String(requestParameters["topic_name"])),
          ),
        method: "POST",
        headers: headerParameters,
        query: queryParameters,
        body: ProduceRequestToJSON(requestParameters["ProduceRequest"]),
      },
      initOverrides,
    );

    return new runtime.JSONApiResponse(response, (jsonValue) => ProduceResponseFromJSON(jsonValue));
  }

  /**
   */
  async gatewayV1ClustersClusterIdTopicsTopicNameRecordsPost(
    requestParameters: GatewayV1ClustersClusterIdTopicsTopicNameRecordsPostRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<ProduceResponse> {
    const response = await this.gatewayV1ClustersClusterIdTopicsTopicNameRecordsPostRaw(
      requestParameters,
      initOverrides,
    );
    return await response.value();
  }
}
