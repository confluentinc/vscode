import { normalize } from "path";
import { Agent, fetch, RequestInit } from "undici";
import { workspace, WorkspaceConfiguration } from "vscode";
import { Logger } from "../logging";
import {
  LOCAL_DOCKER_HOST,
  LOCAL_DOCKER_PORT,
  LOCAL_DOCKER_PROTOCOL,
  LOCAL_DOCKER_SOCKET_PATH,
} from "../preferences/constants";

const logger = new Logger("docker.client");

/** Singleton class to handle fetch requests against the Docker API using extension/user settings. */
export class DockerClient {
  private static instance: DockerClient;
  private constructor() {}

  static getInstance() {
    if (!DockerClient.instance) {
      DockerClient.instance = new DockerClient();
    }
    return DockerClient.instance;
  }

  private get configs(): WorkspaceConfiguration {
    return workspace.getConfiguration();
  }

  private get socketPath(): string {
    let path: string = this.configs.get(LOCAL_DOCKER_SOCKET_PATH, "").trim();
    if (!path || path !== "") {
      // no socketPath config set by user, try to guess the default based on platform
      if (process.platform === "win32") {
        path = normalize("//./pipe/docker_engine");
      } else {
        path = "/var/run/docker.sock";
      }
    } else {
      logger.debug("using docker socket path from extension settings", { socketPath: path });
    }
    return path;
  }

  private get protocol(): string {
    let protocol = this.configs.get(LOCAL_DOCKER_PROTOCOL, "").trim();
    if (!protocol || protocol === "") {
      protocol = "http";
    }
    return protocol;
  }

  private get host(): string {
    let host: string = this.configs.get(LOCAL_DOCKER_HOST, "").trim();
    if (!host || host === "") {
      host = "localhost";
    }
    return host;
  }

  private get port(): number | null {
    return this.configs.get(LOCAL_DOCKER_PORT, null);
  }

  private get baseUrl(): string {
    let url = `${this.protocol}://${this.host}`;
    if (this.port !== null) {
      url = `${url}:${this.port}`;
    }
    return url;
  }

  private get defaultOptions(): RequestInit {
    return {
      dispatcher: new Agent({
        connect: {
          socketPath: this.socketPath ? this.socketPath : undefined,
        },
      }),
    };
  }

  /**
   * Send an HTTP request to the Docker API with the configured protocol, host, port, and socket path.
   *
   * Uses `GET` unless otherwise specified in the options.
   *
   * @param endpoint The API endpoint to send the request to.
   * @param options Additional options to pass to the fetch request.
   * @returns A Promise that resolves with the response from the Docker API.
   */
  async request(endpoint: string, options?: RequestInit): Promise<any> {
    // remove any leading slashes
    const trimmedEndpoint = endpoint.replace(/^\/+/, "");
    const url = `${this.baseUrl}/${trimmedEndpoint}`;
    const requestOptions: RequestInit = { ...this.defaultOptions, ...options };
    try {
      const response = await fetch(url, requestOptions);
      if (!response.ok) {
        const body = await response.text();
        logger.error("error response from docker API:", {
          body,
          status: response.status,
          statusText: response.statusText,
          url,
          options: requestOptions,
        });
        throw new Error(`Error response with status ${response.status}: "${response.statusText}"`);
      }
      // callers should handle reading the response body (JSON, ReadableStream, etc.)
      return response;
    } catch (error) {
      logger.error(`${requestOptions.method?.toUpperCase()} ${url} failed:`, error);
      throw error;
    }
  }
}
