/**
 * VS Code URI handler for OAuth2 callbacks.
 *
 * Handles OAuth callbacks received via the vscode:// URI scheme,
 * providing a platform-independent callback mechanism that works
 * on desktop and VS Code for Web.
 */

import * as vscode from "vscode";
import type { OAuthCallbackResult, OAuthError } from "./types";
import { CALLBACK_URIS } from "./config";

/**
 * Callback handler function type.
 */
export type UriCallbackHandler = (result: OAuthCallbackResult) => void;

/**
 * The expected path for OAuth callbacks.
 */
const CALLBACK_PATH = "/authCallback";

/**
 * VS Code URI handler for OAuth2 authentication callbacks.
 *
 * Registers as a URI handler for the extension and processes
 * OAuth callbacks received via the vscode:// URI scheme.
 */
export class OAuthUriHandler implements vscode.UriHandler, vscode.Disposable {
  private callbackHandler: UriCallbackHandler | null = null;
  private readonly disposables: vscode.Disposable[] = [];
  private isRegistered = false;

  /**
   * Creates a new OAuth URI handler.
   */
  constructor() {
    // Handler is registered when activate() is called
  }

  /**
   * Activates the URI handler by registering with VS Code.
   * @param context The extension context for disposable registration.
   */
  activate(context: vscode.ExtensionContext): void {
    if (this.isRegistered) {
      return;
    }

    const disposable = vscode.window.registerUriHandler(this);
    this.disposables.push(disposable);
    context.subscriptions.push(disposable);
    this.isRegistered = true;
  }

  /**
   * Handles an incoming URI.
   * @param uri The URI to handle.
   */
  handleUri(uri: vscode.Uri): vscode.ProviderResult<void> {
    // Check if this is an OAuth callback
    if (uri.path !== CALLBACK_PATH) {
      // Not an OAuth callback, ignore
      return;
    }

    const result = this.parseCallback(uri);
    this.notifyHandler(result);
  }

  /**
   * Registers a callback handler for OAuth results.
   * @param handler The function to call when a callback is received.
   */
  onCallback(handler: UriCallbackHandler): void {
    this.callbackHandler = handler;
  }

  /**
   * Gets the callback URI for this handler.
   * @returns The VS Code URI for OAuth callbacks.
   */
  getCallbackUri(): string {
    return CALLBACK_URIS.VSCODE_URI;
  }

  /**
   * Checks if the handler is registered with VS Code.
   */
  isActive(): boolean {
    return this.isRegistered;
  }

  /**
   * Disposes of the handler resources.
   */
  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
    this.isRegistered = false;
    this.callbackHandler = null;
  }

  /**
   * Parses an OAuth callback from a URI.
   */
  private parseCallback(uri: vscode.Uri): OAuthCallbackResult {
    const params = new URLSearchParams(uri.query);

    const code = params.get("code");
    const error = params.get("error");
    const errorDescription = params.get("error_description");
    const errorUri = params.get("error_uri");
    const state = params.get("state");

    if (error) {
      const oauthError: OAuthError = {
        error,
        errorDescription: errorDescription ?? undefined,
        errorUri: errorUri ?? undefined,
      };

      return {
        success: false,
        state: state ?? undefined,
        error: oauthError,
      };
    }

    if (!code) {
      return {
        success: false,
        state: state ?? undefined,
        error: {
          error: "missing_code",
          errorDescription: "No authorization code provided in callback",
        },
      };
    }

    return {
      success: true,
      code,
      state: state ?? undefined,
    };
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
}

/**
 * Creates a callback URI with the authorization code.
 * Useful for testing and simulation.
 * @param code The authorization code.
 * @param state The state parameter.
 * @returns A VS Code URI with the callback parameters.
 */
export function createCallbackUri(code: string, state?: string): vscode.Uri {
  const params = new URLSearchParams({ code });
  if (state) {
    params.set("state", state);
  }

  return vscode.Uri.parse(`${CALLBACK_URIS.VSCODE_URI}?${params.toString()}`);
}

/**
 * Creates an error callback URI.
 * Useful for testing and simulation.
 * @param error The error code.
 * @param errorDescription The error description.
 * @param state The state parameter.
 * @returns A VS Code URI with the error parameters.
 */
export function createErrorCallbackUri(
  error: string,
  errorDescription?: string,
  state?: string,
): vscode.Uri {
  const params = new URLSearchParams({ error });
  if (errorDescription) {
    params.set("error_description", errorDescription);
  }
  if (state) {
    params.set("state", state);
  }

  return vscode.Uri.parse(`${CALLBACK_URIS.VSCODE_URI}?${params.toString()}`);
}
