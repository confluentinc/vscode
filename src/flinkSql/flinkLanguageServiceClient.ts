/**
 * Flink Language Service Client.
 *
 * Handles direct WebSocket connection to CCloud's Flink Language Service.
 * Replaces the sidecar's proxy functionality for Flink SQL language support.
 */

import type { Disposable } from "vscode";
import type { CloseEvent, ErrorEvent, MessageEvent } from "ws";
import { WebSocket } from "ws";
import { TokenManager } from "../auth/oauth2/tokenManager";
import { logError } from "../errors";
import { Logger } from "../logging";
import {
  type FlinkLspConnectionParams,
  type TokenProvider,
  createTokenReplacer,
  sendAuthMessage,
} from "./flinkLspAuth";
import { buildFlinkLspUrl } from "./privateEndpointResolver";

const logger = new Logger("flinkSql.flinkLanguageServiceClient");

/**
 * Configuration for the Flink Language Service client.
 */
export interface FlinkLspClientConfig {
  /** Function to retrieve the data plane token. */
  getToken?: TokenProvider;
  /** WebSocket connection timeout in milliseconds. */
  connectionTimeout?: number;
  /** WebSocket options passed to the ws constructor. */
  webSocketOptions?: {
    headers?: Record<string, string>;
  };
}

/**
 * Default configuration values.
 */
const DEFAULT_CONFIG: Required<Pick<FlinkLspClientConfig, "connectionTimeout">> = {
  connectionTimeout: 30000, // 30 seconds
};

/**
 * Connection state for the language service client.
 */
export enum FlinkLspConnectionState {
  /** Not connected. */
  DISCONNECTED = "DISCONNECTED",
  /** Connection in progress. */
  CONNECTING = "CONNECTING",
  /** Connected and authenticated. */
  CONNECTED = "CONNECTED",
  /** Connection failed. */
  FAILED = "FAILED",
}

/**
 * Events emitted by the Flink Language Service client.
 */
export interface FlinkLspClientEvents {
  /** Called when connection state changes. */
  onStateChange?: (state: FlinkLspConnectionState) => void;
  /** Called when a message is received (after auth). */
  onMessage?: (data: string) => void;
  /** Called when an error occurs. */
  onError?: (error: Error) => void;
  /** Called when the connection is closed. */
  onClose?: (code: number, reason: string) => void;
}

/**
 * Flink Language Service Client interface.
 */
export interface FlinkLanguageServiceClient extends Disposable {
  /** Connects to the Flink LSP. */
  connect(params: FlinkLspConnectionParams): Promise<WebSocket>;
  /** Checks if currently connected. */
  isConnected(): boolean;
  /** Gets the underlying WebSocket (null if not connected). */
  getWebSocket(): WebSocket | null;
  /** Gets the current connection state. */
  getState(): FlinkLspConnectionState;
  /** Disconnects from the Flink LSP. */
  disconnect(): void;
}

/**
 * Implementation of the Flink Language Service client.
 */
class FlinkLspClient implements FlinkLanguageServiceClient {
  private ws: WebSocket | null = null;
  private state: FlinkLspConnectionState = FlinkLspConnectionState.DISCONNECTED;
  private readonly config: FlinkLspClientConfig;
  private readonly events: FlinkLspClientEvents;
  private connectionParams: FlinkLspConnectionParams | null = null;
  private tokenReplacer: ((message: string) => Promise<string>) | null = null;

  constructor(config: FlinkLspClientConfig = {}, events: FlinkLspClientEvents = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.events = events;

    // Set up token replacer if token provider is available
    const tokenProvider = config.getToken ?? defaultTokenProvider;
    this.tokenReplacer = createTokenReplacer(tokenProvider);
  }

  /**
   * Gets the current connection state.
   */
  getState(): FlinkLspConnectionState {
    return this.state;
  }

  /**
   * Checks if currently connected.
   */
  isConnected(): boolean {
    return (
      this.state === FlinkLspConnectionState.CONNECTED && this.ws?.readyState === WebSocket.OPEN
    );
  }

  /**
   * Gets the underlying WebSocket.
   */
  getWebSocket(): WebSocket | null {
    return this.ws;
  }

  /**
   * Connects to the Flink LSP.
   * @param params Connection parameters.
   * @returns Promise that resolves to the WebSocket once authenticated.
   */
  async connect(params: FlinkLspConnectionParams): Promise<WebSocket> {
    if (this.ws) {
      this.disconnect();
    }

    this.connectionParams = params;
    this.setState(FlinkLspConnectionState.CONNECTING);

    // Build the LSP URL (uses private endpoint if configured)
    const lspUrl = buildFlinkLspUrl(params.environmentId, params.region, params.provider);
    logger.debug("Connecting to Flink LSP", { url: lspUrl, params });

    return new Promise<WebSocket>((resolve, reject) => {
      let resolved = false;
      let timeoutId: NodeJS.Timeout | null = null;

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
      };

      const handleSuccess = (ws: WebSocket) => {
        if (!resolved) {
          resolved = true;
          cleanup();
          resolve(ws);
        }
      };

      const handleFailure = (error: Error) => {
        if (!resolved) {
          resolved = true;
          cleanup();
          this.setState(FlinkLspConnectionState.FAILED);
          reject(error);
        }
      };

      // Set up connection timeout
      timeoutId = setTimeout(() => {
        handleFailure(new Error(`Connection timeout after ${this.config.connectionTimeout}ms`));
        this.disconnect();
      }, this.config.connectionTimeout);

      // Get token for auth header
      const tokenProvider = this.config.getToken ?? defaultTokenProvider;
      tokenProvider()
        .then((token) => {
          if (!token) {
            handleFailure(new Error("No data plane token available"));
            return;
          }

          // Create WebSocket with auth header
          const wsOptions = {
            headers: {
              authorization: `Bearer ${token}`,
              ...this.config.webSocketOptions?.headers,
            },
          };

          this.ws = new WebSocket(lspUrl, wsOptions);
          this.setupWebSocketHandlers(handleSuccess, handleFailure, tokenProvider);
        })
        .catch((error) => {
          handleFailure(error instanceof Error ? error : new Error(String(error)));
        });
    });
  }

  /**
   * Sets up WebSocket event handlers.
   */
  private setupWebSocketHandlers(
    onSuccess: (ws: WebSocket) => void,
    onFailure: (error: Error) => void,
    tokenProvider: TokenProvider,
  ): void {
    if (!this.ws || !this.connectionParams) {
      return;
    }

    const ws = this.ws;
    const params = this.connectionParams;

    ws.onopen = async () => {
      logger.debug("WebSocket connection opened");

      try {
        // Send auth message immediately after connection
        await sendAuthMessage(ws, params, tokenProvider);

        // Connection is now authenticated
        this.setState(FlinkLspConnectionState.CONNECTED);
        logger.debug("Flink LSP connection authenticated");
        onSuccess(ws);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logError(err, "Failed to authenticate with Flink LSP");
        onFailure(err);
        this.disconnect();
      }
    };

    ws.onmessage = (event: MessageEvent) => {
      const data = typeof event.data === "string" ? event.data : event.data.toString("utf8");
      this.events.onMessage?.(data);
    };

    ws.onerror = (event: ErrorEvent) => {
      const error = new Error(event.message || "WebSocket error");
      logError(error, "Flink LSP WebSocket error");
      this.events.onError?.(error);
      onFailure(error);
    };

    ws.onclose = (event: CloseEvent) => {
      logger.debug("WebSocket connection closed", { code: event.code, reason: event.reason });
      this.setState(FlinkLspConnectionState.DISCONNECTED);
      this.events.onClose?.(event.code, event.reason);
    };
  }

  /**
   * Wraps the WebSocket to intercept outgoing messages for token replacement.
   * This method returns a wrapped send function that handles token placeholders.
   */
  async wrapMessage(message: string): Promise<string> {
    if (this.tokenReplacer) {
      return this.tokenReplacer(message);
    }
    return message;
  }

  /**
   * Disconnects from the Flink LSP.
   */
  disconnect(): void {
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        try {
          this.ws.close(1000, "Client disconnect");
        } catch (error) {
          logger.warn("Error closing WebSocket", { error });
        }
      }
      this.ws = null;
    }
    this.setState(FlinkLspConnectionState.DISCONNECTED);
    this.connectionParams = null;
  }

  /**
   * Disposes of resources.
   */
  dispose(): void {
    this.disconnect();
  }

  /**
   * Updates the connection state and notifies listeners.
   */
  private setState(newState: FlinkLspConnectionState): void {
    if (this.state !== newState) {
      const oldState = this.state;
      this.state = newState;
      logger.trace("State changed", { oldState, newState });
      this.events.onStateChange?.(newState);
    }
  }
}

/**
 * Default token provider using TokenManager.
 */
async function defaultTokenProvider(): Promise<string | null> {
  return TokenManager.getInstance().getDataPlaneToken();
}

/**
 * Creates a new Flink Language Service client.
 * @param config Client configuration.
 * @param events Event handlers.
 * @returns A new Flink Language Service client.
 */
export function createFlinkLanguageServiceClient(
  config: FlinkLspClientConfig = {},
  events: FlinkLspClientEvents = {},
): FlinkLanguageServiceClient {
  return new FlinkLspClient(config, events);
}

/**
 * Builds the direct Flink LSP WebSocket URL for a compute pool.
 * This is a convenience function that delegates to the private endpoint resolver.
 * @param environmentId The environment ID.
 * @param region The cloud region.
 * @param provider The cloud provider.
 * @returns The Flink LSP WebSocket URL.
 */
export function buildDirectFlinkLspUrl(
  environmentId: string,
  region: string,
  provider: string,
): string {
  return buildFlinkLspUrl(environmentId, region, provider);
}
