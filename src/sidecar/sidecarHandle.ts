import { type TadaDocumentNode } from "gql.tada";
import { print } from "graphql";

// OpenAPI generated static client classes

import {
  ConfigsV3Api,
  Configuration as KafkaRestConfiguration,
  PartitionV3Api,
  RecordsV3Api,
  TopicV3Api,
} from "../clients/kafkaRest";
import {
  Configuration as SchemaRegistryRestConfiguration,
  SchemasV1Api,
  SubjectsV1Api,
} from "../clients/schemaRegistryRest";
import {
  ConfigurationParameters,
  ConnectionsResourceApi,
  KafkaConsumeResourceApi,
  MicroProfileHealthApi,
  Middleware,
  PreferencesResourceApi,
  ResponseError,
  Configuration as SidecarRestConfiguration,
  TemplatesApi,
  VersionResourceApi,
} from "../clients/sidecar";
import { Logger } from "../logging";
import {
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
   * Creates and returns a (Sidecar REST OpenAPI spec) {@link TemplatesApi} client instance with a
   * preconfigured {@link SidecarRestConfiguration}.
   */
  public getTemplatesApi(): TemplatesApi {
    const config = new SidecarRestConfiguration({
      ...this.defaultClientConfigParams,
      headers: {
        ...this.defaultClientConfigParams.headers,
        // Intercept requests to set the Accept header to `application/*` to handle non-JSON responses
        // For example, the sidecar returns a ZIP file for the `POST /gateway/v1/templates/{name}/apply` endpoint
        Accept: "application/*",
      },
    });
    return new TemplatesApi(config);
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
  public getKafkaConsumeApi(connectionId: string) {
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
  public getTopicV3Api(clusterId: string, connectionId: string): TopicV3Api {
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

  public getConfigsV3Api(clusterId: string, connectionId: string): ConfigsV3Api {
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
  public getPartitionV3Api(clusterId: string, connectionId: string): PartitionV3Api {
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
  public getRecordsV3Api(clusterId: string, connectionId: string): RecordsV3Api {
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

  // --- SCHEMA REGISTRY REST OPENAPI CLIENT METHODS ---

  /**
   * Creates and returns a (Schema Registry REST OpenAPI spec) {@link SchemasV1Api} client instance
   * with a preconfigured {@link SchemaRegistryRestConfiguration}.
   */
  public getSchemasV1Api(clusterId: string, connectionId: string): SchemasV1Api {
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
  public getSubjectsV1Api(clusterId: string, connectionId: string): SubjectsV1Api {
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
