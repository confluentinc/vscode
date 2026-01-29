/**
 * HTTP Client for proxying requests to Confluent services.
 *
 * Provides a robust HTTP client with:
 * - Configurable retry logic with exponential backoff
 * - Request timeout handling
 * - Authentication header injection
 * - Response error handling
 */

/**
 * HTTP methods supported by the client.
 */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * Authentication types for requests.
 */
export type AuthType = "bearer" | "basic" | "api-key" | "none";

/**
 * Authentication configuration for requests.
 */
export interface AuthConfig {
  /** Type of authentication. */
  type: AuthType;
  /** Bearer token (for bearer auth). */
  token?: string;
  /** Username (for basic auth). */
  username?: string;
  /** Password (for basic auth). */
  password?: string;
  /** API key (for api-key auth). */
  apiKey?: string;
  /** API secret (for api-key auth). */
  apiSecret?: string;
}

/**
 * HTTP client configuration options.
 */
export interface HttpClientConfig {
  /** Base URL for all requests. */
  baseUrl: string;
  /** Default timeout in milliseconds (default: 30000). */
  timeout?: number;
  /** Maximum number of retry attempts (default: 3). */
  maxRetries?: number;
  /** Base delay for exponential backoff in ms (default: 1000). */
  retryDelay?: number;
  /** Default authentication configuration. */
  auth?: AuthConfig;
  /** Default headers to include in all requests. */
  defaultHeaders?: Record<string, string>;
}

/**
 * Request options for individual requests.
 */
export interface RequestOptions {
  /** HTTP method. */
  method?: HttpMethod;
  /** Request headers (merged with defaults). */
  headers?: Record<string, string>;
  /** Request body (will be JSON stringified if object). */
  body?: unknown;
  /** Query parameters. */
  params?: Record<string, string | number | boolean | undefined>;
  /** Override timeout for this request. */
  timeout?: number;
  /** Override retry count for this request. */
  maxRetries?: number;
  /** Override authentication for this request. */
  auth?: AuthConfig;
  /** Skip retry logic for this request. */
  noRetry?: boolean;
  /** Abort signal for cancelling the request. */
  signal?: AbortSignal;
}

/**
 * HTTP response wrapper.
 */
export interface HttpResponse<T = unknown> {
  /** Response status code. */
  status: number;
  /** Response status text. */
  statusText: string;
  /** Response headers. */
  headers: Headers;
  /** Parsed response body. */
  data: T;
  /** Whether the request was successful (2xx status). */
  ok: boolean;
}

/**
 * Error thrown when an HTTP request fails.
 */
export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly statusText: string,
    public readonly data?: unknown,
    public readonly headers?: Headers,
  ) {
    super(message);
    this.name = "HttpError";
  }

  /**
   * Whether this is a client error (4xx).
   */
  get isClientError(): boolean {
    return this.status >= 400 && this.status < 500;
  }

  /**
   * Whether this is a server error (5xx).
   */
  get isServerError(): boolean {
    return this.status >= 500;
  }

  /**
   * Whether this error is retryable.
   */
  get isRetryable(): boolean {
    // Retry on server errors and specific client errors
    return (
      this.isServerError ||
      this.status === 429 || // Too Many Requests
      this.status === 408 // Request Timeout
    );
  }
}

/**
 * Error thrown when a request times out.
 */
export class TimeoutError extends Error {
  constructor(
    message: string,
    public readonly timeout: number,
  ) {
    super(message);
    this.name = "TimeoutError";
  }
}

/**
 * Default configuration values.
 */
const DEFAULTS = {
  TIMEOUT: 30000,
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000,
};

/**
 * HTTP Client for making requests to Confluent services.
 */
export class HttpClient {
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly retryDelay: number;
  private readonly defaultAuth?: AuthConfig;
  private readonly defaultHeaders: Record<string, string>;

  /**
   * Creates a new HTTP client.
   * @param config Client configuration.
   */
  constructor(config: HttpClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, ""); // Remove trailing slash
    this.timeout = config.timeout ?? DEFAULTS.TIMEOUT;
    this.maxRetries = config.maxRetries ?? DEFAULTS.MAX_RETRIES;
    this.retryDelay = config.retryDelay ?? DEFAULTS.RETRY_DELAY;
    this.defaultAuth = config.auth;
    this.defaultHeaders = {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...config.defaultHeaders,
    };
  }

  /**
   * Makes a GET request.
   * @param path Request path (relative to base URL).
   * @param options Request options.
   * @returns The response.
   */
  async get<T = unknown>(path: string, options?: RequestOptions): Promise<HttpResponse<T>> {
    return this.request<T>(path, { ...options, method: "GET" });
  }

  /**
   * Makes a POST request.
   * @param path Request path (relative to base URL).
   * @param body Request body.
   * @param options Request options.
   * @returns The response.
   */
  async post<T = unknown>(
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<HttpResponse<T>> {
    return this.request<T>(path, { ...options, method: "POST", body });
  }

  /**
   * Makes a PUT request.
   * @param path Request path (relative to base URL).
   * @param body Request body.
   * @param options Request options.
   * @returns The response.
   */
  async put<T = unknown>(
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<HttpResponse<T>> {
    return this.request<T>(path, { ...options, method: "PUT", body });
  }

  /**
   * Makes a PATCH request.
   * @param path Request path (relative to base URL).
   * @param body Request body.
   * @param options Request options.
   * @returns The response.
   */
  async patch<T = unknown>(
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<HttpResponse<T>> {
    return this.request<T>(path, { ...options, method: "PATCH", body });
  }

  /**
   * Makes a DELETE request.
   * @param path Request path (relative to base URL).
   * @param options Request options.
   * @returns The response.
   */
  async delete<T = unknown>(path: string, options?: RequestOptions): Promise<HttpResponse<T>> {
    return this.request<T>(path, { ...options, method: "DELETE" });
  }

  /**
   * Makes an HTTP request with retry logic.
   * @param path Request path (relative to base URL).
   * @param options Request options.
   * @returns The response.
   */
  async request<T = unknown>(path: string, options: RequestOptions = {}): Promise<HttpResponse<T>> {
    const maxRetries = options.noRetry ? 0 : options.maxRetries ?? this.maxRetries;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.executeRequest<T>(path, options);
      } catch (error) {
        lastError = error as Error;

        // Don't retry if it's not retryable
        if (error instanceof HttpError && !error.isRetryable) {
          throw error;
        }

        // Don't retry on timeout if it's the last attempt
        if (attempt === maxRetries) {
          throw error;
        }

        // Calculate backoff delay
        const delay = this.calculateBackoff(attempt);
        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  /**
   * Executes a single HTTP request.
   */
  private async executeRequest<T>(path: string, options: RequestOptions): Promise<HttpResponse<T>> {
    const url = this.buildUrl(path, options.params);
    const headers = this.buildHeaders(options);
    const timeout = options.timeout ?? this.timeout;

    const fetchOptions: RequestInit = {
      method: options.method ?? "GET",
      headers,
    };

    if (options.body !== undefined) {
      fetchOptions.body =
        typeof options.body === "string" ? options.body : JSON.stringify(options.body);
    }

    // Create abort controller for timeout
    const controller = new AbortController();
    fetchOptions.signal = controller.signal;

    // Link external signal to our controller if provided
    if (options.signal) {
      if (options.signal.aborted) {
        controller.abort();
      } else {
        options.signal.addEventListener("abort", () => controller.abort(), { once: true });
      }
    }

    const timeoutId = setTimeout(() => {
      controller.abort();
    }, timeout);

    try {
      const response = await fetch(url, fetchOptions);

      clearTimeout(timeoutId);

      // Parse response body
      const data = await this.parseResponse<T>(response);

      if (!response.ok) {
        throw new HttpError(
          `HTTP ${response.status}: ${response.statusText}`,
          response.status,
          response.statusText,
          data,
          response.headers,
        );
      }

      return {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        data,
        ok: true,
      };
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof HttpError) {
        throw error;
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw new TimeoutError(`Request timed out after ${timeout}ms`, timeout);
      }

      throw error;
    }
  }

  /**
   * Builds the full URL with query parameters.
   */
  private buildUrl(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
  ): string {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${normalizedPath}`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    return url.toString();
  }

  /**
   * Builds request headers with authentication.
   */
  private buildHeaders(options: RequestOptions): Record<string, string> {
    const headers: Record<string, string> = { ...this.defaultHeaders };

    // Add custom headers
    if (options.headers) {
      Object.assign(headers, options.headers);
    }

    // Add authentication
    const auth = options.auth ?? this.defaultAuth;
    if (auth) {
      const authHeader = this.buildAuthHeader(auth);
      if (authHeader) {
        headers["Authorization"] = authHeader;
      }
    }

    // Remove headers with empty values (allows overriding defaults with empty string to remove)
    for (const [key, value] of Object.entries(headers)) {
      if (value === "" || value === undefined) {
        delete headers[key];
      }
    }

    return headers;
  }

  /**
   * Builds the Authorization header for the given auth config.
   */
  private buildAuthHeader(auth: AuthConfig): string | undefined {
    switch (auth.type) {
      case "bearer":
        return auth.token ? `Bearer ${auth.token}` : undefined;

      case "basic":
        if (auth.username && auth.password) {
          const credentials = Buffer.from(`${auth.username}:${auth.password}`).toString("base64");
          return `Basic ${credentials}`;
        }
        return undefined;

      case "api-key":
        if (auth.apiKey && auth.apiSecret) {
          const credentials = Buffer.from(`${auth.apiKey}:${auth.apiSecret}`).toString("base64");
          return `Basic ${credentials}`;
        }
        return undefined;

      case "none":
        return undefined;
    }
  }

  /**
   * Parses the response body.
   */
  private async parseResponse<T>(response: Response): Promise<T> {
    const contentType = response.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      try {
        return (await response.json()) as T;
      } catch {
        return undefined as T;
      }
    }

    // Return text for non-JSON responses
    const text = await response.text();
    return text as unknown as T;
  }

  /**
   * Calculates exponential backoff delay.
   */
  private calculateBackoff(attempt: number): number {
    // Exponential backoff with jitter
    const exponentialDelay = this.retryDelay * Math.pow(2, attempt);
    const jitter = Math.random() * 0.3 * exponentialDelay;
    return Math.min(exponentialDelay + jitter, 30000); // Max 30 seconds
  }

  /**
   * Sleeps for the specified duration.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Creates an HTTP client with the given configuration.
 * @param config Client configuration.
 * @returns A configured HTTP client.
 */
export function createHttpClient(config: HttpClientConfig): HttpClient {
  return new HttpClient(config);
}
