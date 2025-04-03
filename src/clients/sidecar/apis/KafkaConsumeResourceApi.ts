/* tslint:disable */
/* eslint-disable */
/**
 * Confluent ide-sidecar API
 * API for the Confluent ide-sidecar, part of Confluent for VS Code
 *
 * The version of the OpenAPI document: 0.187.0
 * Contact: vscode@confluent.io
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */

import * as runtime from "../runtime";
import type {
  SimpleConsumeMultiPartitionRequest,
  SimpleConsumeMultiPartitionResponse,
} from "../models/index";
import {
  SimpleConsumeMultiPartitionRequestFromJSON,
  SimpleConsumeMultiPartitionRequestToJSON,
  SimpleConsumeMultiPartitionResponseFromJSON,
  SimpleConsumeMultiPartitionResponseToJSON,
} from "../models/index";

export interface GatewayV1ClustersClusterIdTopicsTopicNamePartitionsConsumePostRequest {
  cluster_id: string;
  topic_name: string;
  x_connection_id: string;
  SimpleConsumeMultiPartitionRequest?: SimpleConsumeMultiPartitionRequest;
}

/**
 *
 */
export class KafkaConsumeResourceApi extends runtime.BaseAPI {
  /**
   */
  async gatewayV1ClustersClusterIdTopicsTopicNamePartitionsConsumePostRaw(
    requestParameters: GatewayV1ClustersClusterIdTopicsTopicNamePartitionsConsumePostRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<runtime.ApiResponse<SimpleConsumeMultiPartitionResponse>> {
    if (requestParameters["cluster_id"] == null) {
      throw new runtime.RequiredError(
        "cluster_id",
        'Required parameter "cluster_id" was null or undefined when calling gatewayV1ClustersClusterIdTopicsTopicNamePartitionsConsumePost().',
      );
    }

    if (requestParameters["topic_name"] == null) {
      throw new runtime.RequiredError(
        "topic_name",
        'Required parameter "topic_name" was null or undefined when calling gatewayV1ClustersClusterIdTopicsTopicNamePartitionsConsumePost().',
      );
    }

    if (requestParameters["x_connection_id"] == null) {
      throw new runtime.RequiredError(
        "x_connection_id",
        'Required parameter "x_connection_id" was null or undefined when calling gatewayV1ClustersClusterIdTopicsTopicNamePartitionsConsumePost().',
      );
    }

    const queryParameters: any = {};

    const headerParameters: runtime.HTTPHeaders = {};

    headerParameters["Content-Type"] = "application/json";

    if (requestParameters["x_connection_id"] != null) {
      headerParameters["x-connection-id"] = String(requestParameters["x_connection_id"]);
    }

    const response = await this.request(
      {
        path: `/gateway/v1/clusters/{cluster_id}/topics/{topic_name}/partitions/-/consume`
          .replace(`{${"cluster_id"}}`, encodeURIComponent(String(requestParameters["cluster_id"])))
          .replace(
            `{${"topic_name"}}`,
            encodeURIComponent(String(requestParameters["topic_name"])),
          ),
        method: "POST",
        headers: headerParameters,
        query: queryParameters,
        body: SimpleConsumeMultiPartitionRequestToJSON(
          requestParameters["SimpleConsumeMultiPartitionRequest"],
        ),
      },
      initOverrides,
    );

    return new runtime.JSONApiResponse(response, (jsonValue) =>
      SimpleConsumeMultiPartitionResponseFromJSON(jsonValue),
    );
  }

  /**
   */
  async gatewayV1ClustersClusterIdTopicsTopicNamePartitionsConsumePost(
    requestParameters: GatewayV1ClustersClusterIdTopicsTopicNamePartitionsConsumePostRequest,
    initOverrides?: RequestInit | runtime.InitOverrideFunction,
  ): Promise<SimpleConsumeMultiPartitionResponse> {
    const response = await this.gatewayV1ClustersClusterIdTopicsTopicNamePartitionsConsumePostRaw(
      requestParameters,
      initOverrides,
    );
    return await response.value();
  }
}
