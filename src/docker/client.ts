import { normalize } from "path";
import { Agent, fetch, RequestInit } from "undici";
import { getConfigs } from "../configs";
import { Logger } from "../logging";

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

  private get socketPath(): string {
    let path: string = getConfigs().get("localDocker.socketPath", "").trim();
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
    let protocol = getConfigs().get("localDocker.protocol", "").trim();
    if (!protocol || protocol === "") {
      protocol = "http";
    }
    return protocol;
  }

  private get host(): string {
    let host: string = getConfigs().get("localDocker.host", "").trim();
    if (!host || host === "") {
      host = "localhost";
    }
    return host;
  }

  private get port(): number | null {
    return getConfigs().get<number | null>("localDocker.port") ?? null;
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

    try {
      const response = await fetch(url, {
        ...this.defaultOptions,
        ...options,
      });
      if (!response.ok) {
        throw new Error(`Error response with status ${response.status}: "${response.statusText}"`);
      }
      // callers should handle reading the response body (JSON, ReadableStream, etc.)
      return response;
    } catch (error) {
      logger.error(`GET ${url} failed`, error);
      throw error;
    }
  }
}
