/**
 * Local HTTP server for OAuth2 callback handling.
 *
 * Provides a fallback mechanism for receiving OAuth callbacks when the
 * Auth0 configuration doesn't support the VS Code URI scheme.
 * Listens on port 26636 (same as the sidecar) for backwards compatibility.
 */

import * as http from "http";
import type * as vscode from "vscode";
import type { OAuthCallbackResult, OAuthError } from "./types";
import { OAUTH_CONSTANTS } from "./config";

/**
 * HTML response for successful authentication.
 */
const SUCCESS_HTML = `
<!DOCTYPE html>
<html>
<head>
  <title>Authentication Successful</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
           display: flex; justify-content: center; align-items: center; height: 100vh;
           margin: 0; background: #f5f5f5; }
    .container { text-align: center; padding: 40px; background: white;
                 border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .success { color: #22863a; font-size: 48px; margin-bottom: 20px; }
    h1 { margin: 0 0 10px 0; color: #333; }
    p { color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <div class="success">&#10003;</div>
    <h1>Authentication Successful</h1>
    <p>You can close this window and return to VS Code.</p>
  </div>
</body>
</html>
`;

/**
 * HTML response for failed authentication.
 */
const ERROR_HTML = (error: string, description?: string) => `
<!DOCTYPE html>
<html>
<head>
  <title>Authentication Failed</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
           display: flex; justify-content: center; align-items: center; height: 100vh;
           margin: 0; background: #f5f5f5; }
    .container { text-align: center; padding: 40px; background: white;
                 border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .error { color: #cb2431; font-size: 48px; margin-bottom: 20px; }
    h1 { margin: 0 0 10px 0; color: #333; }
    p { color: #666; }
    .details { margin-top: 20px; padding: 10px; background: #f8f8f8;
               border-radius: 4px; font-family: monospace; font-size: 12px; color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <div class="error">&#10007;</div>
    <h1>Authentication Failed</h1>
    <p>${description || "An error occurred during authentication."}</p>
    <div class="details">Error: ${error}</div>
  </div>
</body>
</html>
`;

/**
 * Callback handler function type.
 */
export type CallbackHandler = (result: OAuthCallbackResult) => void;

/**
 * Local HTTP server for receiving OAuth2 callbacks.
 *
 * This server listens on the configured port and handles OAuth callbacks
 * from the authorization server. It extracts the authorization code or
 * error from the callback URL and notifies registered handlers.
 */
export class OAuthCallbackServer implements vscode.Disposable {
  private server: http.Server | null = null;
  private readonly port: number;
  private readonly callbackPath: string;
  private callbackHandler: CallbackHandler | null = null;
  private isStarted = false;

  /**
   * Creates a new OAuth callback server.
   * @param port The port to listen on (defaults to 26636).
   * @param callbackPath The path to handle callbacks (defaults to /gateway/v1/callback-vscode-docs).
   */
  constructor(
    port: number = OAUTH_CONSTANTS.CALLBACK_SERVER_PORT,
    callbackPath: string = "/gateway/v1/callback-vscode-docs",
  ) {
    this.port = port;
    this.callbackPath = callbackPath;
  }

  /**
   * Starts the callback server.
   * @returns A promise that resolves when the server is listening, or rejects if it can't start.
   */
  async start(): Promise<void> {
    if (this.isStarted) {
      return;
    }

    // Check if port is available
    const portInUse = await this.isPortInUse();
    if (portInUse) {
      throw new Error(`Port ${this.port} is already in use. Another instance may be running.`);
    }

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res));

      this.server.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "EADDRINUSE") {
          reject(new Error(`Port ${this.port} is already in use.`));
        } else {
          reject(error);
        }
      });

      this.server.listen(this.port, "127.0.0.1", () => {
        this.isStarted = true;
        resolve();
      });
    });
  }

  /**
   * Stops the callback server.
   */
  async stop(): Promise<void> {
    if (!this.server || !this.isStarted) {
      return;
    }

    return new Promise((resolve) => {
      this.server!.close(() => {
        this.server = null;
        this.isStarted = false;
        resolve();
      });
    });
  }

  /**
   * Registers a callback handler for OAuth results.
   * @param handler The function to call when a callback is received.
   */
  onCallback(handler: CallbackHandler): void {
    this.callbackHandler = handler;
  }

  /**
   * Gets the callback URL for this server.
   */
  getCallbackUrl(): string {
    return `http://127.0.0.1:${this.port}${this.callbackPath}`;
  }

  /**
   * Checks if the server is currently running.
   */
  isRunning(): boolean {
    return this.isStarted;
  }

  /**
   * Gets the port the server is configured to use.
   */
  getPort(): number {
    return this.port;
  }

  /**
   * Disposes of the server resources.
   */
  dispose(): void {
    this.stop().catch(() => {
      // Ignore errors during dispose
    });
  }

  /**
   * Handles an incoming HTTP request.
   */
  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // Only handle GET requests to the callback path
    if (req.method !== "GET") {
      this.sendResponse(res, 405, "Method Not Allowed");
      return;
    }

    const url = new URL(req.url ?? "/", `http://127.0.0.1:${this.port}`);

    if (!url.pathname.startsWith(this.callbackPath)) {
      this.sendResponse(res, 404, "Not Found");
      return;
    }

    // Extract OAuth parameters
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");
    const errorDescription = url.searchParams.get("error_description");
    const state = url.searchParams.get("state");

    if (error) {
      // Handle error response
      const oauthError: OAuthError = {
        error,
        errorDescription: errorDescription ?? undefined,
        errorUri: url.searchParams.get("error_uri") ?? undefined,
      };

      const result: OAuthCallbackResult = {
        success: false,
        state: state ?? undefined,
        error: oauthError,
      };

      this.notifyHandler(result);
      this.sendHtmlResponse(res, 400, ERROR_HTML(error, errorDescription ?? undefined));
      return;
    }

    if (!code) {
      // Missing authorization code
      const result: OAuthCallbackResult = {
        success: false,
        state: state ?? undefined,
        error: {
          error: "missing_code",
          errorDescription: "No authorization code provided in callback",
        },
      };

      this.notifyHandler(result);
      this.sendHtmlResponse(res, 400, ERROR_HTML("missing_code", "No authorization code provided"));
      return;
    }

    // Successful callback
    const result: OAuthCallbackResult = {
      success: true,
      code,
      state: state ?? undefined,
    };

    this.notifyHandler(result);
    this.sendHtmlResponse(res, 200, SUCCESS_HTML);
  }

  /**
   * Notifies the registered handler of an OAuth result.
   */
  private notifyHandler(result: OAuthCallbackResult): void {
    if (this.callbackHandler) {
      try {
        this.callbackHandler(result);
      } catch {
        // Ignore handler errors
      }
    }
  }

  /**
   * Sends a plain text response.
   */
  private sendResponse(res: http.ServerResponse, statusCode: number, message: string): void {
    res.writeHead(statusCode, { "Content-Type": "text/plain" });
    res.end(message);
  }

  /**
   * Sends an HTML response.
   */
  private sendHtmlResponse(res: http.ServerResponse, statusCode: number, html: string): void {
    res.writeHead(statusCode, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(html);
  }

  /**
   * Checks if the configured port is already in use.
   */
  private async isPortInUse(): Promise<boolean> {
    return new Promise((resolve) => {
      const testServer = http.createServer();

      testServer.once("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "EADDRINUSE") {
          resolve(true);
        } else {
          resolve(false);
        }
      });

      testServer.once("listening", () => {
        testServer.close(() => resolve(false));
      });

      testServer.listen(this.port, "127.0.0.1");
    });
  }
}
