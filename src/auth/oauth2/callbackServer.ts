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
import { CALLBACK_URIS, OAUTH_CONSTANTS } from "./config";

/**
 * Shared styles for callback pages (supports light/dark mode).
 */
const STYLES = `
<style>
  /* Axon theme design tokens partial */
  :root {
    --background: #F5F4F4;
    --text-primary: #131316;
    --link-primary: #4933D7;
    --link-primary-hover: #30228B;
    --support-failure: #C43B42;
    --logo: #040531;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --background: #131316;
      --text-primary: #F5F4F4;
      --link-primary: #BDB3FF;
      --link-primary-hover: #B4A8FF;
      --support-failure: #F07A80;
      --logo: #FFFFFF;
    }
  }

  /* Page styling */
  a, a:active { color: var(--link-primary); }
  a:hover { color: var(--link-primary-hover); }

  body {
    margin: 0;
    overflow: hidden;
    background-color: var(--background);
    color: var(--text-primary);
  }

  /* Logo styling */
  div.logo {
    width: 320px;
  }
  .logo .st0{ fill: none; }
  .logo .st1{ fill: var(--logo); }

  /* Content styling */
  div.banner {
    margin: 80px 32px;
    font-family: 'MarkPro-NarrowBook', 'Arial', sans-serif;
    text-align: center;
  }

  /* Util styling */
  .failure { color: var(--support-failure); }
</style>
`;

/**
 * Confluent logo SVG.
 */
const CONFLUENT_LOGO = `
<div class="logo">
  <svg id="Layer_1" xmlns="http://www.w3.org/2000/svg" x="0px" y="0px" viewBox="0 0 1475 467.84" xml:space="preserve">
    <g>
      <rect class="st0" width="1475" height="467.84"/>
    </g>
    <g>
      <g>
        <path class="st1" d="M482.17,246.58h11.01c-4.3,20.54-21.08,34.37-43.5,34.37c-26.32,0-47.53-20.41-47.53-47.39
          s21.21-47.26,47.53-47.26c22.42,0,39.2,13.69,43.5,34.24h-11.01c-3.76-14.9-15.84-24.3-32.49-24.3
          c-20.68,0-36.79,15.98-36.79,37.32s16.11,37.46,36.79,37.46C466.33,271.01,478.41,261.35,482.17,246.58"/>
        <path class="st1" d="M602.72,233.55c0-20.68-16.11-37.32-36.78-37.32c-20.68,0-36.79,16.65-36.79,37.32
          c0,20.68,16.11,37.32,36.79,37.32C586.61,270.88,602.72,254.23,602.72,233.55 M613.46,233.55c0,26.31-21.21,47.26-47.53,47.26
          c-26.32,0-47.53-20.95-47.53-47.26c0-26.32,21.21-47.26,47.53-47.26C592.25,186.29,613.46,207.24,613.46,233.55"/>
      </g>
      <polygon class="st1" points="722.2,187.91 722.2,279.2 713.34,279.2 654.94,207.24 654.94,279.2 644.33,279.2 644.33,187.91
        652.93,187.91 711.6,260.81 711.6,187.91"/>
      <polygon class="st1" points="771,197.71 771,231.27 817.45,231.27 817.45,241.07 771,241.07 771,279.2 760.39,279.2 760.39,187.9
        823.09,187.9 823.09,197.71"/>
      <polygon class="st1" points="920.69,269.4 920.69,279.2 859.73,279.2 859.73,187.91 870.34,187.91 870.34,269.4"/>
      <g>
        <path class="st1" d="M1021.77,240.13c0,24.3-15.57,40.68-39.07,40.68c-23.49,0-39.07-16.38-39.07-40.68V187.9h10.61v52.23
          c0,17.86,11.28,30.75,28.46,30.75c17.05,0,28.46-12.89,28.46-30.75V187.9h10.61V240.13z"/>
      </g>
      <polygon class="st1" points="1069.59,197.71 1069.59,228.99 1117.52,228.99 1117.52,238.79 1069.59,238.79 1069.59,269.4
        1122.89,269.4 1122.89,279.2 1058.98,279.2 1058.98,187.9 1122.89,187.9 1122.89,197.71"/>
      <polygon class="st1" points="1232.47,187.91 1232.47,279.2 1223.61,279.2 1165.21,207.24 1165.21,279.2 1154.6,279.2
        1154.6,187.91 1163.2,187.91 1221.87,260.81 1221.87,187.91"/>
      <polygon class="st1" points="1260.63,187.91 1260.63,197.71 1294.19,197.71 1294.19,279.2 1304.8,279.2 1304.8,197.71
        1338.5,197.71 1338.5,187.91"/>
      <g>
        <path class="st1" d="M263.68,230.76c-8.73-0.27-17.47-0.34-26.2-0.39c-0.02-8.74-0.06-17.48-0.29-26.21l-0.42-14.88
          c-0.25-4.96-0.4-9.92-0.75-14.88h-4.2c-0.35,4.96-0.5,9.92-0.75,14.88l-0.42,14.88c-0.11,4.1-0.16,8.2-0.21,12.3
          c-1.61-3.77-3.23-7.54-4.9-11.29l-6.08-13.59c-2.13-4.49-4.17-9.01-6.39-13.46l-3.88,1.61c1.57,4.72,3.34,9.35,5,14.03l5.31,13.91
          c1.47,3.83,2.99,7.64,4.52,11.44c-2.93-2.87-5.87-5.73-8.84-8.55l-10.82-10.23c-3.69-3.33-7.3-6.73-11.05-9.99l-2.97,2.97
          c3.26,3.76,6.66,7.37,9.99,11.05l10.23,10.82c2.82,2.98,5.68,5.91,8.55,8.84c-3.8-1.53-7.61-3.05-11.44-4.52l-13.91-5.31
          c-4.68-1.66-9.32-3.43-14.04-5l-1.61,3.88c4.45,2.22,8.98,4.25,13.46,6.39l13.59,6.08c3.75,1.67,7.51,3.29,11.28,4.9
          c-4.1,0.04-8.2,0.1-12.3,0.21l-14.88,0.42c-4.96,0.25-9.92,0.4-14.88,0.75v4.2c4.96,0.35,9.92,0.5,14.88,0.75l14.88,0.42
          c8.74,0.24,17.48,0.28,26.21,0.3c0.05,8.73,0.12,17.47,0.39,26.2l0.46,14.88c0.27,4.96,0.43,9.92,0.79,14.88h3.81
          c0.36-4.96,0.52-9.92,0.79-14.88l0.46-14.88c0.13-4.2,0.2-8.4,0.26-12.6c1.66,3.86,3.33,7.71,5.06,11.54l6.12,13.57
          c2.15,4.48,4.19,9,6.42,13.45l3.52-1.46c-1.57-4.72-3.31-9.36-4.97-14.05l-5.27-13.92c-1.49-3.93-3.03-7.84-4.58-11.74
          c3.01,2.93,6.03,5.85,9.09,8.73l10.85,10.2c3.7,3.32,7.32,6.71,11.08,9.96l2.7-2.7c-3.25-3.76-6.64-7.39-9.96-11.08l-10.2-10.85
          c-2.88-3.06-5.8-6.08-8.73-9.09c3.9,1.55,7.81,3.1,11.74,4.58l13.93,5.27c4.68,1.65,9.33,3.4,14.05,4.97l1.46-3.52
          c-4.44-2.23-8.97-4.28-13.45-6.42l-13.57-6.12c-3.83-1.73-7.68-3.4-11.54-5.06c4.2-0.06,8.4-0.13,12.6-0.26l14.88-0.46
          c4.96-0.27,9.92-0.43,14.88-0.79v-3.81c-4.96-0.36-9.92-0.52-14.88-0.79L263.68,230.76z"/>
        <path class="st1" d="M233.92,136.5c-53.72,0-97.42,43.7-97.42,97.42c0,53.72,43.7,97.42,97.42,97.42s97.42-43.7,97.42-97.42
          C331.34,180.2,287.64,136.5,233.92,136.5z M233.92,322.23c-48.69,0-88.31-39.61-88.31-88.31c0-48.69,39.61-88.31,88.31-88.31
          c48.7,0,88.31,39.62,88.31,88.31C322.23,282.61,282.62,322.23,233.92,322.23z"/>
      </g>
    </g>
  </svg>
</div>
`;

/** Confluent Cloud homepage URL */
const CONFLUENT_CLOUD_URL = "https://confluent.cloud";

/**
 * HTML response for successful authentication.
 * Includes a script to redirect to the VS Code extension URI handler.
 */
const SUCCESS_HTML = (vscodeRedirectUri: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <title>Confluent VS Code Extension</title>
  <link rel="shortcut icon" href="https://www.confluent.io/favicon.ico"/>
  ${STYLES}
  <meta name="color-scheme" content="light dark">
  <script type="text/javascript">
    // Redirect to the VS Code extension's URI handler to complete the auth flow
    window.onload = function() {
      const redirectUri = "${vscodeRedirectUri}";
      if (redirectUri.length > 0) {
        window.location.href = redirectUri + "?success=true";
      }
    };
  </script>
</head>
<body>
${CONFLUENT_LOGO}
<div class="banner">
  <h1>Authentication Complete</h1>
  <p>You have successfully authenticated with Confluent Cloud.</p>
  <p>
    If you prefer to log in with a different account, please head to
    <a href="${CONFLUENT_CLOUD_URL}">Confluent Cloud</a> in your browser, sign out, and start
    the authentication flow in Confluent for VS Code again.
  </p>
  <p>You may close this page.</p>
</div>
</body>
</html>
`;

/**
 * HTML response for failed authentication.
 * Includes a script to redirect to the VS Code extension URI handler.
 */
const ERROR_HTML = (vscodeRedirectUri: string, error: string, description?: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <title>Confluent VS Code Extension</title>
  <link rel="shortcut icon" href="https://www.confluent.io/favicon.ico"/>
  ${STYLES}
  <meta name="color-scheme" content="light dark">
  <script type="text/javascript">
    // Redirect to the VS Code extension's URI handler to notify of failure
    window.onload = function() {
      const redirectUri = "${vscodeRedirectUri}";
      if (redirectUri.length > 0) {
        window.location.href = redirectUri + "?success=false";
      }
    };
  </script>
</head>
<body>
${CONFLUENT_LOGO}
<div class="banner">
  <h1>Authentication Failed</h1>
  <p>We couldn't complete the authentication with Confluent Cloud due to the following error:</p>
  <p><b class="failure">${description || error}</b></p>
  <p>You may close this page and <a href="${vscodeRedirectUri}?success=false">re-start the authentication flow</a> in Confluent for VS Code.</p>
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
      this.sendHtmlResponse(
        res,
        400,
        ERROR_HTML(CALLBACK_URIS.VSCODE_URI, error, errorDescription ?? undefined),
      );
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
      this.sendHtmlResponse(
        res,
        400,
        ERROR_HTML(CALLBACK_URIS.VSCODE_URI, "missing_code", "No authorization code provided"),
      );
      return;
    }

    // Successful callback
    const result: OAuthCallbackResult = {
      success: true,
      code,
      state: state ?? undefined,
    };

    this.notifyHandler(result);
    this.sendHtmlResponse(res, 200, SUCCESS_HTML(CALLBACK_URIS.VSCODE_URI));
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
