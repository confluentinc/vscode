import { type TadaDocumentNode } from "gql.tada";
import { print } from "graphql";

// OpenAPI generated static client classes

import {
  Configuration as KafkaRestConfiguration,
  PartitionV3Api,
  TopicV3Api,
} from "../clients/kafkaRest";
import {
  Configuration as SchemaRegistryRestConfiguration,
  SchemasV1Api,
  SubjectsV1Api,
} from "../clients/schemaRegistryRest";
import {
  Configuration,
  ConfigurationParameters,
  ConnectionsResourceApi,
  KafkaConsumeResourceApi,
  MicroProfileHealthApi,
  Middleware,
  PreferencesResourceApi,
  ResponseError,
  TemplatesApi,
  VersionResourceApi,
} from "../clients/sidecar";
import { Logger } from "../logging";
import {
  ENABLE_REQUEST_RESPONSE_LOGGING,
  SIDECAR_BASE_URL,
  SIDECAR_CURRENT_CONNECTION_ID_HEADER,
  SIDECAR_PROCESS_ID_HEADER,
} from "./constants";
import {
  CCloudRecentRequestsMiddleware,
  DebugRequestResponseMiddleware,
  ErrorResponseMiddleware,
  setDebugOutputChannel,
} from "./middlewares";

const logger = new Logger("sidecarHandle");

// sidecar handle module
// Represents a short-term handle to a running, handshaken sidecar process.
// Should be used for a single code block and then discarded.
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
      // Intercept requests to set the Accept header to `application/*` to handle non-JSON responses
      // For example, the sidecar returns a ZIP file for the `POST /gateway/v1/templates/{name}/apply` endpoint
      Accept: "application/*",
      // Set the Authorization header to the current auth token.
      Authorization: `Bearer ${this.auth_secret}`,
    };

    let middleware: Middleware[] = [
      new ErrorResponseMiddleware(),
      new CCloudRecentRequestsMiddleware(),
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

  /* Convenience methods to return the pre-configured OpenAPI-spec generated sidecar client
    services for making REST requests to the sidecar. Obtaining from a SidecarHandle
    obtained from getSidecar() ensures that the sidecar has been started, handshook with,
    and that OpenAPI request filter has been installed which will inject the necessary
    auth and process id headers.
  */

  createCustomHeaders(headers: Record<string, string>): Record<string, string> {
    return { ...this.defaultHeaders, ...headers };
  }

  createClientConfig(params?: ConfigurationParameters): Configuration {
    if (params == null) {
      return new Configuration(this.defaultClientConfigParams);
    }
    // if any headers are passed, make sure we don't replace the default headers
    if (params.headers != null) {
      params.headers = this.createCustomHeaders(params.headers);
    }
    return new Configuration({ ...this.defaultClientConfigParams, ...params });
  }

  // Return a client instance for making REST requests to the sidecar.
  private getClient<T>(
    clientServiceClass: new (config: Configuration) => T,
    configParams?: ConfigurationParameters,
  ): T {
    const config: Configuration = this.createClientConfig(configParams);
    return new clientServiceClass(config);
  }

  // Return the ConnectionsResourceApi client instance for making REST requests to the sidecar.
  public getConnectionsResourceApi(configParams?: ConfigurationParameters): ConnectionsResourceApi {
    return this.getClient(ConnectionsResourceApi, configParams);
  }

  // Return the TemplatesApi client instance for making REST requests to the sidecar.
  public getTemplatesApi(configParams?: ConfigurationParameters): TemplatesApi {
    return this.getClient(TemplatesApi, configParams);
  }

  public VersionResourceApi(configParams?: ConfigurationParameters): VersionResourceApi {
    return this.getClient(VersionResourceApi, configParams);
  }

  public getTopicV3Api(clusterId: string, connectionId: string): TopicV3Api {
    const config: unknown = this.createClientConfig({
      headers: { "x-cluster-id": clusterId, "x-connection-id": connectionId },
    });
    return new TopicV3Api(config as KafkaRestConfiguration);
  }

  public getPartitionV3Api(clusterId: string, connectionId: string): PartitionV3Api {
    const config: unknown = this.createClientConfig({
      headers: { "x-cluster-id": clusterId, "x-connection-id": connectionId },
    });
    return new PartitionV3Api(config as KafkaRestConfiguration);
  }

  public getSchemasV1Api(clusterId: string, connectionId: string): SchemasV1Api {
    const config: unknown = this.createClientConfig({
      headers: { "x-cluster-id": clusterId, "x-connection-id": connectionId },
    });
    return new SchemasV1Api(config as SchemaRegistryRestConfiguration);
  }

  public getSubjectsV1Api(clusterId: string, connectionId: string): SubjectsV1Api {
    const config: unknown = this.createClientConfig({
      headers: { "x-cluster-id": clusterId, "x-connection-id": connectionId },
    });
    return new SubjectsV1Api(config as SchemaRegistryRestConfiguration);
  }

  public getKafkaConsumeApi(connectionId: string) {
    const configuration = this.createClientConfig({
      headers: { "x-connection-id": connectionId },
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

  public getPreferencesApi() {
    return new PreferencesResourceApi(this.createClientConfig());
  }

  // Make a GraphQL request to the sidecar.
  public async query<Result, Variables>(
    query: TadaDocumentNode<Result, Variables>,
    connectionId: string,
    // Mark second parameter as optional if Variables is an empty object type
    // The signature looks odd, but it's the only way to make optional param by condition
    ...[variables]: Variables extends Record<any, never> ? [never?] : [Variables]
  ): Promise<Result> {
    const headers = new Headers();
    headers.append("Content-Type", "application/json");
    headers.append("Authorization", `Bearer ${this.auth_secret}`);
    headers.append(SIDECAR_CURRENT_CONNECTION_ID_HEADER, connectionId);

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

  public getMicroProfileHealthApi(config: Configuration): MicroProfileHealthApi {
    // Factored out of getSidecarPid() to allow for test mocking.
    return new MicroProfileHealthApi(config);
  }

  /** Return the PID of the sidecar process by provoking it to raise a 401 Unauthorized error.
   * with the PID in the response header.
   * */
  public async getSidecarPid(): Promise<number> {
    // coax the sidecar to yield its pid by sending a bad auth token request to the
    // healthcheck route.

    const config = this.createClientConfig({
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
