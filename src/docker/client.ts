import { normalize } from "path";
import { Agent, fetch, RequestInit } from "undici";
import { getConfigs } from "../configs";
import { Logger } from "../logging";

const logger = new Logger("docker.client");

export class DockerClient {
  private protocol: string = "http";
  private host: string = "localhost";
  private port: number | null = null;
  private socketPath: string;

  private abortController: AbortController = new AbortController();

  private static instance: DockerClient;
  private constructor() {
    this.socketPath = this.setSocketPath();
    this.host = this.setHost();
    this.port = this.setPort();
  }

  static getInstance() {
    if (!DockerClient.instance) {
      DockerClient.instance = new DockerClient();
    }
    return DockerClient.instance;
  }

  private setSocketPath(): string {
    let socketPath: string = getConfigs().get("localDocker.socketPath", "").trim();
    if (!socketPath || socketPath !== "") {
      // no socketPath config set by user, try to guess the default based on platform
      if (process.platform === "win32") {
        socketPath = normalize("//./pipe/docker_engine");
      } else {
        socketPath = "/var/run/docker.sock";
      }
    } else {
      logger.debug("using docker socket path from extension settings", { socketPath });
    }
    return socketPath;
  }

  private setHost(): string {
    let host: string = getConfigs().get("localDocker.host", "").trim();
    if (!host || host === "") {
      host = "localhost";
    }
    return host;
  }

  private setPort(): number | null {
    return getConfigs().get<number | null>("localDocker.port") ?? null;
  }

  private get baseUrl(): string {
    let url = `${this.protocol}://${this.host}`;
    if (this.port) {
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
      signal: this.abortController.signal,
    };
  }

  cancel() {
    this.abortController.abort();
    logger.info("Docker event listening cancelled");
  }

  async get(endpoint: string, options?: RequestInit): Promise<any> {
    // remove any leading slashes
    const trimmedEndpoint = endpoint.replace(/^\/+/, "");
    const url = `${this.baseUrl}/${trimmedEndpoint}`;

    try {
      const response = await fetch(url, {
        ...this.defaultOptions,
        ...options,
      });
      if (!response.ok) {
        throw new Error(
          `GET ${url} failed with status ${response.status}: "${response.statusText}"`,
        );
      }
      // callers should handle reading the response body (JSON, ReadableStream, etc.)
      return response;
    } catch (error) {
      logger.error(`GET ${url} failed`, error);
      throw error;
    }
  }
}
