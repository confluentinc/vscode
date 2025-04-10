import { type TadaDocumentNode } from "gql.tada";
import { print } from "graphql";

// OpenAPI generated static client classes

import {
  ComputePoolsFcpmV2Api,
  Configuration as FlinkComputePoolsConfiguration,
} from "../clients/flinkComputePool";

import {
  FlinkArtifactsArtifactV1Api,
  Configuration as FlinkArtifactsConfiguration,
} from "../clients/flinkArtifacts";
import { Configuration as FlinkSqlConfiguration, StatementsSqlV1Api } from "../clients/flinkSql";
import {
  ConfigsV3Api,
  Configuration as KafkaRestConfiguration,
  PartitionV3Api,
  RecordsV3Api,
  TopicV3Api,
} from "../clients/kafkaRest";
import {
  Configuration as ScaffoldingServiceConfiguration,
  TemplatesScaffoldV1Api,
} from "../clients/scaffoldingService";
import {
  Configuration as SchemaRegistryRestConfiguration,
  SchemasV1Api,
  SubjectsV1Api,
} from "../clients/schemaRegistryRest";
import {
  ConfigurationParameters,
  ConfluentCloudProduceRecordsResourceApi,
  ConnectionsResourceApi,
  HTTPHeaders,
  KafkaConsumeResourceApi,
  MicroProfileHealthApi,
  Middleware,
  PreferencesResourceApi,
  ResponseError,
  Configuration as SidecarRestConfiguration,
  VersionResourceApi,
} from "../clients/sidecar";
import { CCLOUD_CONNECTION_ID } from "../constants";
import { Logger } from "../logging";
import { ConnectionId, IEnvProviderRegion } from "../models/resource";
import { Message, MessageType } from "../ws/messageTypes";
import {
  CCLOUD_PROVIDER_HEADER,
  CCLOUD_REGION_HEADER,
  CLUSTER_ID_HEADER,
  ENABLE_REQUEST_RESPONSE_LOGGING,
  SIDECAR_BASE_URL,
  SIDECAR_CONNECTION_ID_HEADER,
  SIDECAR_PROCESS_ID_HEADER,
} from "./constants";
import {
  CCloudAuthStatusMiddleware,
  DebugRequestResponseMiddleware,
  ErrorResponseMiddleware,
  setDebugOutputChannel,
} from "./middlewares";
import { WebsocketManager } from "./websocketManager";

const logger = new Logger("sidecarHandle");

/**
 * A short-term handle to a running, handshaken sidecar process.
 * Should be used for a single code block and then discarded.
 */
export class SidecarHandle {
  authToken: string;
  myPid: string;
  myId: number;

  defaultHeaders: Record<string, string>;
  defaultClientConfigParams: ConfigurationParameters;

  constructor(
    public auth_secret: string,
    myPid: string,
    handleId: number,
  ) {
    this.authToken = auth_secret;
    this.myPid = myPid;
    // perhaps will be useful in future logging?
    this.myId = handleId;

    // used for client creation for individual service (class) methods, merged with any custom
    // config parameters provided by the caller
    this.defaultHeaders = {
      // Expect JSON request and response bodies unless otherwise overridden (e.g. TemplatesApi).
      Accept: "application/json",
      "Content-Type": "application/json",
      // Set the Authorization header to the current auth token.
      Authorization: `Bearer ${this.auth_secret}`,
    };

    let middleware: Middleware[] = [
      new ErrorResponseMiddleware(),
      new CCloudAuthStatusMiddleware(),
    ];
    if (ENABLE_REQUEST_RESPONSE_LOGGING) {
      // Add middleware to log request and response details; disabled by default
      setDebugOutputChannel();
      middleware.unshift(new DebugRequestResponseMiddleware());
    }

    this.defaultClientConfigParams = {
      basePath: SIDECAR_BASE_URL,
      headers: this.defaultHeaders,
      middleware: middleware,
    };
  }

  // Websocket sending methods

  /**
   * Send a message to / through sidecar over the websocket.
   * The websocket send is ultimately async underneath the hood.
   * @throws {WebsocketClosedError} if the websocket is not connected.
   */
  public wsSend<T extends MessageType>(message: Message<T>): void {
    if (message.headers.originator !== this.myPid) {
      throw new Error(
        `Expected message originator to be '${this.myPid}', got '${message.headers.originator}'`,
      );
    }

    WebsocketManager.getInstance().send(message);
  }

  // future method for sending message to all peer workspaces, when needed and we
  // have a known subset of message types enumerating those messages. Can skip
  // sending the message if the known workspace peer count == 0.
  // public wsBroadcastToPeers<T extends BroadcastMessageType>(message: Message<T>): void {
  // ...

  // === OPENAPI CLIENT METHODS ===

  // --- SIDECAR OPENAPI CLIENT METHODS ---

  /**
   * Creates and returns a (Sidecar REST OpenAPI spec) {@link ConnectionsResourceApi} client instance with a preconfigured
   * {@link SidecarRestConfiguration}.
   */
  public getConnectionsResourceApi(): ConnectionsResourceApi {
    const config = new SidecarRestConfiguration(this.defaultClientConfigParams);
    return new ConnectionsResourceApi(config);
  }

  /**
   * Creates and returns a (Scaffolding Service OpenAPI spec) {@link TemplatesApi} client instance
   * with a preconfigured {@link ScaffoldingServiceConfiguration}.
   */
  public getTemplatesApi(): TemplatesScaffoldV1Api {
    const config = new ScaffoldingServiceConfiguration({
      headers: {
        // Intercept requests to set the Accept header to `application/*` to handle non-JSON responses
        // For example, the service returns a ZIP file for the `POST .../apply` endpoint
        Accept: "application/*",
      },
    });
    return new TemplatesScaffoldV1Api(config);
  }

  /**
   * Creates and returns a (Sidecar REST OpenAPI spec) {@link VersionResourceApi} client instance
   * with a preconfigured {@link SidecarRestConfiguration}.
   */
  public getVersionResourceApi(configParams?: ConfigurationParameters): VersionResourceApi {
    const config = new SidecarRestConfiguration({
      ...this.defaultClientConfigParams,
      ...configParams,
    });
    return new VersionResourceApi(config);
  }

  /**
   * Creates and returns a (Sidecar REST OpenAPI spec) {@link KafkaConsumeResourceApi} client instance
   * with a preconfigured {@link SidecarRestConfiguration}.
   */
  public getKafkaConsumeApi(connectionId: ConnectionId) {
    const configuration = new SidecarRestConfiguration({
      ...this.defaultClientConfigParams,
      headers: {
        ...this.defaultClientConfigParams.headers,
        [SIDECAR_CONNECTION_ID_HEADER]: connectionId,
      },
      middleware: [
        {
          async onError(context) {
            if (context.error instanceof DOMException) {
              switch (context.error.name) {
                case "TimeoutError":
                case "AbortError":
                  return new Response(
                    JSON.stringify({ message: context.error.message, aborted: true }),
                    { status: 504, headers: { "Content-Type": "application/json" } },
                  );
              }
            }
            if (context.error instanceof Error) {
              return new Response(JSON.stringify({ message: context.error.message }), {
                status: 500,
                headers: { "Content-Type": "application/json" },
              });
            }
          },
        },
      ],
    });
    return new KafkaConsumeResourceApi(configuration);
  }

  /**
   * Creates and returns a (Sidecar REST OpenAPI spec) {@link PreferencesResourceApi} client instance
   * with a preconfigured {@link SidecarRestConfiguration}.
   */
  public getPreferencesApi(): PreferencesResourceApi {
    const config = new SidecarRestConfiguration({
      ...this.defaultClientConfigParams,
    });
    return new PreferencesResourceApi(config);
  }

  /**
   * Creates and returns a (Sidecar REST OpenAPI spec) {@link MicroProfileHealthApi} client instance
   * with the provided {@link SidecarRestConfiguration}.
   */
  public getMicroProfileHealthApi(config: SidecarRestConfiguration): MicroProfileHealthApi {
    // Factored out of getSidecarPid() to allow for test mocking.
    return new MicroProfileHealthApi(config);
  }

  // --- KAFKA REST OPENAPI CLIENT METHODS ---

  /**
   * Creates and returns a (Kafka v3 REST OpenAPI spec) {@link TopicV3Api} client instance with a
   * preconfigured {@link KafkaRestConfiguration}.
   */
  public getTopicV3Api(clusterId: string, connectionId: ConnectionId): TopicV3Api {
    const config = new KafkaRestConfiguration({
      ...this.defaultClientConfigParams,
      headers: {
        ...this.defaultClientConfigParams.headers,
        [CLUSTER_ID_HEADER]: clusterId,
        [SIDECAR_CONNECTION_ID_HEADER]: connectionId,
      },
    });
    return new TopicV3Api(config);
  }

  public getConfigsV3Api(clusterId: string, connectionId: ConnectionId): ConfigsV3Api {
    const config = new KafkaRestConfiguration({
      ...this.defaultClientConfigParams,
      headers: {
        ...this.defaultClientConfigParams.headers,
        [CLUSTER_ID_HEADER]: clusterId,
        [SIDECAR_CONNECTION_ID_HEADER]: connectionId,
      },
    });
    return new ConfigsV3Api(config);
  }

  /**
   * Creates and returns a (Kafka v3 REST OpenAPI spec) {@link PartitionV3Api} client instance with a
   * preconfigured {@link KafkaRestConfiguration}.
   */
  public getPartitionV3Api(clusterId: string, connectionId: ConnectionId): PartitionV3Api {
    const config = new KafkaRestConfiguration({
      ...this.defaultClientConfigParams,
      headers: {
        ...this.defaultClientConfigParams.headers,
        [CLUSTER_ID_HEADER]: clusterId,
        [SIDECAR_CONNECTION_ID_HEADER]: connectionId,
      },
    });
    return new PartitionV3Api(config);
  }

  /**
   * Creates and returns a (Kafka v3 REST OpenAPI spec) {@link RecordsV3Api} client instance with a
   * preconfigured {@link KafkaRestConfiguration}.
   */
  public getRecordsV3Api(clusterId: string, connectionId: ConnectionId): RecordsV3Api {
    const config = new KafkaRestConfiguration({
      ...this.defaultClientConfigParams,
      headers: {
        ...this.defaultClientConfigParams.headers,
        [CLUSTER_ID_HEADER]: clusterId,
        [SIDECAR_CONNECTION_ID_HEADER]: connectionId,
      },
    });
    return new RecordsV3Api(config);
  }

  /**
   * Creates and returns a (Sidecar REST OpenAPI spec) {@link ConfluentCloudProduceRecordsResourceApi} client instance
   * with a preconfigured {@link SidecarRestConfiguration}.
   *
   * NOTE: this is only used for producing to CCloud topics. For non-CCloud topics, use
   * {@link getRecordsV3Api}.
   */
  public getConfluentCloudProduceRecordsResourceApi(
    connectionId: ConnectionId,
  ): ConfluentCloudProduceRecordsResourceApi {
    const configuration = new SidecarRestConfiguration({
      ...this.defaultClientConfigParams,
      headers: {
        ...this.defaultClientConfigParams.headers,
        [SIDECAR_CONNECTION_ID_HEADER]: connectionId,
      },
    });
    return new ConfluentCloudProduceRecordsResourceApi(configuration);
  }

  // --- SCHEMA REGISTRY REST OPENAPI CLIENT METHODS ---

  /**
   * Creates and returns a (Schema Registry REST OpenAPI spec) {@link SchemasV1Api} client instance
   * with a preconfigured {@link SchemaRegistryRestConfiguration}.
   */
  public getSchemasV1Api(clusterId: string, connectionId: ConnectionId): SchemasV1Api {
    const config = new SchemaRegistryRestConfiguration({
      ...this.defaultClientConfigParams,
      headers: {
        ...this.defaultClientConfigParams.headers,
        [CLUSTER_ID_HEADER]: clusterId,
        [SIDECAR_CONNECTION_ID_HEADER]: connectionId,
      },
    });
    return new SchemasV1Api(config);
  }

  /**
   * Creates and returns a (Schema Registry REST OpenAPI spec) {@link SubjectsV1Api} client instance
   * with a preconfigured {@link SchemaRegistryRestConfiguration}.
   */
  public getSubjectsV1Api(clusterId: string, connectionId: ConnectionId): SubjectsV1Api {
    const config = new SchemaRegistryRestConfiguration({
      ...this.defaultClientConfigParams,
      headers: {
        ...this.defaultClientConfigParams.headers,
        [CLUSTER_ID_HEADER]: clusterId,
        [SIDECAR_CONNECTION_ID_HEADER]: connectionId,
      },
    });
    return new SubjectsV1Api(config);
  }

  /** Create and returns a (Flink Artifacts REST OpenAPI spec) {@link FlinkArtifactsArtifactV1Api} client instance */
  public getFlinkArtifactsApi(): FlinkArtifactsArtifactV1Api {
    const config = new FlinkArtifactsConfiguration({
      ...this.defaultClientConfigParams,
      headers: {
        [SIDECAR_CONNECTION_ID_HEADER]: CCLOUD_CONNECTION_ID,
      },
    });
    return new FlinkArtifactsArtifactV1Api(config);
  }

  /** Create and returns a (Flink Compute Pool REST OpenAPI spec) {@link ComputePoolsFcpmV2Api} client instance */
  public getFlinkComputePoolsApi(): ComputePoolsFcpmV2Api {
    const config = new FlinkComputePoolsConfiguration({
      ...this.defaultClientConfigParams,
      headers: {
        [SIDECAR_CONNECTION_ID_HEADER]: CCLOUD_CONNECTION_ID,
      },
    });
    return new ComputePoolsFcpmV2Api(config);
  }

  /** Create and returns a (Flink SQL Statements REST OpenAPI spec) {@link StatementsSqlV1Api} client instance */
  public getFlinkSqlStatementsApi(providerRegion: IEnvProviderRegion): StatementsSqlV1Api {
    const config = new FlinkSqlConfiguration({
      ...this.defaultClientConfigParams,
      headers: this.constructFlinkDataPlaneClientHeaders(providerRegion),
    });
    return new StatementsSqlV1Api(config);
  }

  /** Convert an IProviderRegion to HTTPHeaders for Flink API sidecar client creation. */
  public constructFlinkDataPlaneClientHeaders(providerRegion: IEnvProviderRegion): HTTPHeaders {
    return {
      ...this.defaultClientConfigParams.headers,
      [CCLOUD_PROVIDER_HEADER]: providerRegion.provider,
      [CCLOUD_REGION_HEADER]: providerRegion.region,
      [SIDECAR_CONNECTION_ID_HEADER]: CCLOUD_CONNECTION_ID,
    };
  }

  // === END OF OPENAPI CLIENT METHODS ===

  /**
   * Make a GraphQL request to the sidecar via fetch.
   *
   * NOTE: This uses the GraphQL schema in `src/graphql/sidecar.graphql` to generate the types for
   * the query and variables via the `gql.tada` package.
   */
  public async query<Result, Variables>(
    query: TadaDocumentNode<Result, Variables>,
    connectionId?: string,
    // Mark second parameter as optional if Variables is an empty object type
    // The signature looks odd, but it's the only way to make optional param by condition
    ...[variables]: Variables extends Record<any, never> ? [never?] : [Variables]
  ): Promise<Result> {
    let headers: Headers;
    if (connectionId) {
      headers = new Headers({
        ...this.defaultClientConfigParams.headers,
        [SIDECAR_CONNECTION_ID_HEADER]: connectionId,
      });
    } else {
      headers = new Headers(this.defaultClientConfigParams.headers);
    }

    const response = await fetch(`${SIDECAR_BASE_URL}/gateway/v1/graphql`, {
      method: "POST",
      headers,
      body: JSON.stringify({ query: print(query), variables }),
    });
    const payload = await response.json();

    if (!payload.data) {
      let errorString: string;

      if (payload.errors) {
        // combine all errors into a single error message, if there are multiple
        const errorMessages: string[] = payload.errors.map(
          (error: { message: string }) => error.message || JSON.stringify(error),
        );
        errorString = `GraphQL query failed: ${errorMessages.join(", ")}`;
      } else {
        // we got some other unexpected response structure back, don't attempt to parse it
        errorString = `GraphQL returned unexpected response structure: ${JSON.stringify(payload)}`;
      }
      logger.error(errorString, {
        query: print(query),
        variables: variables,
        payload: JSON.stringify(payload),
      });
      throw new Error(errorString);
    }

    return payload.data;
  }

  /** Return the PID of the sidecar process by provoking it to raise a 401 Unauthorized error.
   * with the PID in the response header.
   * */
  public async getSidecarPid(): Promise<number> {
    // coax the sidecar to yield its pid by sending a bad auth token request to the
    // healthcheck route.
    const config = new SidecarRestConfiguration({
      ...this.defaultClientConfigParams,
      headers: { Authorization: "Bearer bad-token" },
      // Need to prevent the default ErrorResponseMiddleware from catching the error we expect.
      middleware: [],
    });

    const health_api = this.getMicroProfileHealthApi(config);

    // hit the healthcheck route with a bad token to get the sidecar to reveal its pid
    // as a header when it raises 401 Unauthorized.
    try {
      await health_api.microprofileHealthLiveness();
      // If ths didn't raise, then the sidecar is in a very strange state, not enabled its
      // auth token filter!
      logger.error(
        "getSidecarPid(): Failed to get sidecar PID: healthcheck did not raise 401 Unauthorized",
      );
      throw new Error("Failed to get sidecar PID: healthcheck did not raise 401 Unauthorized");
    } catch (e) {
      if (e instanceof ResponseError && e.response.status === 401) {
        const pid_str = e.response.headers.get(SIDECAR_PROCESS_ID_HEADER);
        if (pid_str) {
          const pid = parseInt(pid_str);
          if (isNaN(pid) || pid <= 0) {
            logger.error(
              `getSidecarPid(): Failed to parse valid sidecar PID from response header: ${pid_str}`,
            );
            throw new Error(`Failed to parse sidecar PID from header: ${pid_str}`);
          }
          // Our expected return path.
          return pid!;
        }
      } else {
        logger.error("getSidecarPid(): Failed to get sidecar PID", e);
        throw e;
      }
    }

    logger.error("getSidecarPid(): Failed to get sidecar PID: unexpected error");
    throw new Error("Failed to get sidecar PID: unexpected error");
  }
}
